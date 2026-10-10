// Aurora: controle de programas do Windows pela UI Automation (a árvore dos leitores de tela).
// A small program of its own, not a PowerShell script: inside PowerShell the client-side providers
// of classic Win32 programs (WinForms, Delphi, VB6, parts of Office) fail to load, and their fields
// and buttons came out as nameless "Pane" (09/10/2026). Compiled by the Aurora with the csc.exe of
// the .NET Framework every Windows 10/11 has (app/desktop.js).
// One JSON request per stdin line, one JSON reply per stdout line:
//   windows | snapshot {window, max} | click {ref} | type {ref, text, submit} | key {keys, window} | ping
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Forms;

static class UiaHost {
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);

  static readonly Dictionary<string, AutomationElement> Refs = new Dictionary<string, AutomationElement>();
  static readonly Dictionary<string, AutomationElement> WindowOf = new Dictionary<string, AutomationElement>();
  static int counter = 0;
  static readonly HashSet<string> Actionable = new HashSet<string> { "Button", "MenuItem", "Edit", "ComboBox", "CheckBox", "RadioButton", "ListItem", "TabItem", "Hyperlink", "TreeItem", "DataItem", "SplitButton", "Document", "Spinner", "Slider", "HeaderItem" };
  static readonly HashSet<string> SkipClasses = new HashSet<string> { "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Progman", "WorkerW" };

  static string Kind(AutomationElement el) { return el.Current.ControlType.ProgrammaticName.Replace("ControlType.", ""); }
  static string Proc(AutomationElement el) { try { return Process.GetProcessById(el.Current.ProcessId).ProcessName; } catch { return "?"; } }
  static string Clip(string s, int n) { if (s == null) return ""; s = s.Replace("\r", " ").Replace("\n", " "); return s.Length > n ? s.Substring(0, n) + "…" : s; }

  static List<AutomationElement> TopWindows() {
    var list = new List<AutomationElement>();
    foreach (AutomationElement w in AutomationElement.RootElement.FindAll(TreeScope.Children, Condition.TrueCondition)) {
      try { if (SkipClasses.Contains(w.Current.ClassName) || string.IsNullOrEmpty(w.Current.Name)) continue; list.Add(w); } catch { }
    }
    return list;
  }

  static AutomationElement FindWindow(string query) {
    var wins = TopWindows();
    if (!string.IsNullOrEmpty(query)) {
      string q = query.ToLowerInvariant();
      foreach (var w in wins) if (w.Current.Name.ToLowerInvariant() == q) return w;
      foreach (var w in wins) if (w.Current.Name.ToLowerInvariant().Contains(q)) return w;
      foreach (var w in wins) if (Proc(w).ToLowerInvariant().Contains(q)) return w;
      throw new Exception("Nenhuma janela aberta com '" + query + "'. Veja as janelas com desktop_windows.");
    }
    foreach (var w in wins) { string p = Proc(w); if (p != "Harness Aurora" && p != "electron" && w.Current.Name != "Aurora") return w; }
    throw new Exception("Nenhuma janela de programa aberta.");
  }

  static string ValueOf(AutomationElement el) {
    object p;
    if (el.TryGetCurrentPattern(ValuePattern.Pattern, out p)) return Clip(((ValuePattern)p).Current.Value, 80);
    return null;
  }

  static string States(AutomationElement el) {
    var s = new List<string>();
    try { if (!el.Current.IsEnabled) s.Add("desativado"); } catch { }
    object p;
    try { if (el.TryGetCurrentPattern(TogglePattern.Pattern, out p) && ((TogglePattern)p).Current.ToggleState == ToggleState.On) s.Add("marcado"); } catch { }
    try { if (el.TryGetCurrentPattern(SelectionItemPattern.Pattern, out p) && ((SelectionItemPattern)p).Current.IsSelected) s.Add("selecionado"); } catch { }
    try { if (el.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out p)) s.Add(((ExpandCollapsePattern)p).Current.ExpandCollapseState == ExpandCollapseState.Expanded ? "aberto" : "fechado"); } catch { }
    return s.Count > 0 ? " (" + string.Join(", ", s) + ")" : "";
  }

  // Office's ribbon (Access, Excel, Word): hundreds of buttons, most of them off. The work area (the
  // navigation pane, the table, the form) comes first; from the ribbon only its tabs and live buttons,
  // after. With the ribbon first, Access spent 140 elements before reaching its tables (10/10/2026).
  static readonly HashSet<string> RibbonNames = new HashSet<string> { "Ribbon", "Faixa de Opções", "MsoDockTop", "Business Bar" };
  static bool IsRibbon(AutomationElement el) { try { return RibbonNames.Contains(el.Current.Name) && (Kind(el) == "ToolBar" || Kind(el) == "Pane"); } catch { return false; } }
  static readonly HashSet<string> Clickables = new HashSet<string> { "Button", "MenuItem", "SplitButton", "Hyperlink" };

  // A field with no name of its own takes the label just before it ("Nome" then the text box).
  static string Snapshot(AutomationElement window, int max) {
    var lines = new List<string>();
    lines.Add("Janela: " + window.Current.Name + "  [programa: " + Proc(window) + "]");
    int count = 0;
    string lastLabel = null;
    var walker = TreeWalker.ControlViewWalker;
    var ribbons = new List<KeyValuePair<AutomationElement, int>>();
    bool inRibbon = false;
    int ribbonBudget = 0;
    Action<AutomationElement, int> walk = null;
    walk = (el, depth) => {
      if (count >= max || depth > 30) return;
      AutomationElement child;
      try { child = walker.GetFirstChild(el); } catch { return; }
      while (child != null && count < max) {
        bool skip = false;
        try { skip = child.Current.IsOffscreen && Kind(child) != "Window"; } catch { skip = true; }
        // The ribbon is set aside for the second pass.
        if (!skip && !inRibbon && IsRibbon(child)) { ribbons.Add(new KeyValuePair<AutomationElement, int>(child, depth)); skip = true; }
        // A button that is off can't be clicked: not worth a line.
        if (!skip) { try { if (!child.Current.IsEnabled && Clickables.Contains(Kind(child))) skip = true; } catch { } }
        // In the ribbon, only its tabs and buttons, up to its own budget.
        if (!skip && inRibbon) { string k = Kind(child); if (ribbonBudget <= 0) skip = true; else if (k == "TabItem" || Clickables.Contains(k) || k == "Edit" || k == "ComboBox") ribbonBudget--; }
        if (!skip) {
          string kind = Kind(child), name = Clip(child.Current.Name, 90), value = null;
          try { value = ValueOf(child); } catch { }
          if (kind == "Text" && name.Length > 0) lastLabel = name;
          if (name.Length == 0 && (kind == "Edit" || kind == "ComboBox") && lastLabel != null) name = lastLabel;
          bool show = name.Length > 0 || !string.IsNullOrEmpty(value) || Actionable.Contains(kind);
          if (show) {
            counter++;
            string r = "d" + counter;
            Refs[r] = child; WindowOf[r] = window;
            var line = new StringBuilder(new string(' ', Math.Min(depth, 8) * 2));
            line.Append("[" + r + "] " + kind);
            if (name.Length > 0) line.Append(" \"" + name + "\"");
            if (!string.IsNullOrEmpty(value) && value != name) line.Append(" = \"" + value + "\"");
            line.Append(States(child));
            lines.Add(line.ToString());
            count++;
          }
          walk(child, depth + 1);
        }
        try { child = walker.GetNextSibling(child); } catch { child = null; }
      }
    };
    walk(window, 0);
    if (ribbons.Count > 0 && count < max) {
      lines.Add("— Faixa de opções (abas e botões ativos):");
      inRibbon = true;
      ribbonBudget = Math.Min(60, max - count);
      foreach (var r in ribbons) walk(r.Key, 1);
      inRibbon = false;
    }
    if (count >= max) lines.Add("… (janela grande: mostrei " + max + " elementos; abra o menu ou a parte que interessa e veja de novo)");
    return string.Join("\n", lines);
  }

  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

  static bool IsForeground(AutomationElement window) {
    uint fgPid, pid = (uint)window.Current.ProcessId;
    GetWindowThreadProcessId(GetForegroundWindow(), out fgPid);
    return fgPid == pid;
  }

  // Windows does not always let a background program bring another window forward; when it fails,
  // keys sent "to the window" go to whatever is in front. So the window is brought forward with the
  // allowed tricks (a harmless Shift tap, joining the input queue of the window in front), and keys are
  // sent only when it really is in front (09/10/2026: a copy found the wrong window in front).
  static void Focus(AutomationElement window) {
    try {
      var h = new IntPtr(window.Current.NativeWindowHandle);
      if (h == IntPtr.Zero) return;
      if (IsIconic(h)) ShowWindow(h, 9);
      if (SetForegroundWindow(h) && IsForeground(window)) { Thread.Sleep(120); return; }
      // A Shift tap gives this process the "last input" Windows asks for. Not Alt: in classic programs
      // Alt opens the menu bar, and the Ctrl+A/Ctrl+C after it went to the menu (10/10/2026).
      keybd_event(0x10, 0, 0, UIntPtr.Zero); keybd_event(0x10, 0, 2, UIntPtr.Zero);
      uint ignored;
      uint front = GetWindowThreadProcessId(GetForegroundWindow(), out ignored), self = GetCurrentThreadId();
      AttachThreadInput(self, front, true);
      BringWindowToTop(h); SetForegroundWindow(h);
      AttachThreadInput(self, front, false);
      Thread.Sleep(150);
    } catch { }
  }

  // Keys only to the window asked for: never typed into whatever happens to be in front.
  static void EnsureFront(AutomationElement window) {
    Focus(window);
    if (!IsForeground(window)) throw new Exception("Não consegui trazer a janela \"" + window.Current.Name + "\" para a frente, então não enviei teclas (iriam para outra janela). Peça à pessoa para clicar nela e tente de novo.");
  }

  static AutomationElement Element(string r) {
    if (r == null || !Refs.ContainsKey(r)) throw new Exception("Não conheço o ref '" + r + "'. Veja a janela de novo com desktop_snapshot e use um ref da lista nova.");
    return Refs[r];
  }

  static string Click(string r) {
    var el = Element(r);
    Focus(WindowOf[r]);
    string label = el.Current.Name;
    object p;
    if (el.TryGetCurrentPattern(InvokePattern.Pattern, out p)) { ((InvokePattern)p).Invoke(); return "Cliquei \"" + label + "\" (" + r + ")."; }
    if (el.TryGetCurrentPattern(TogglePattern.Pattern, out p)) { ((TogglePattern)p).Toggle(); return "Marquei/desmarquei \"" + label + "\" (" + r + ")."; }
    if (el.TryGetCurrentPattern(SelectionItemPattern.Pattern, out p)) { ((SelectionItemPattern)p).Select(); return "Selecionei \"" + label + "\" (" + r + ")."; }
    if (el.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out p)) {
      var ec = (ExpandCollapsePattern)p;
      if (ec.Current.ExpandCollapseState == ExpandCollapseState.Expanded) { ec.Collapse(); return "Fechei \"" + label + "\" (" + r + ")."; }
      ec.Expand(); return "Abri \"" + label + "\" (" + r + ").";
    }
    EnsureFront(WindowOf[r]);
    var pt = el.GetClickablePoint();
    SetCursorPos((int)pt.X, (int)pt.Y);
    mouse_event(0x02, 0, 0, 0, UIntPtr.Zero); mouse_event(0x04, 0, 0, 0, UIntPtr.Zero);
    return "Cliquei com o mouse em \"" + label + "\" (" + r + ").";
  }

  static string Escape(string text) { return Regex.Replace(text, @"([+^%~(){}\[\]])", "{$1}").Replace("\r\n", "{ENTER}").Replace("\n", "{ENTER}"); }

  // A form field is filled; a document (an editor's whole text) is never replaced: the text goes in at
  // the cursor. Replacing a Notepad tab wiped the person's file content (09/10/2026, first test).
  static string TypeIn(string r, string text, bool submit) {
    var el = Element(r);
    Focus(WindowOf[r]);
    string how = null;
    object p;
    if (Kind(el) != "Document" && el.TryGetCurrentPattern(ValuePattern.Pattern, out p) && !((ValuePattern)p).Current.IsReadOnly) {
      try { ((ValuePattern)p).SetValue(text); how = "preenchi"; } catch { }
    }
    if (how == null) { EnsureFront(WindowOf[r]); try { el.SetFocus(); } catch { } SendKeys.SendWait(Escape(text)); how = "digitei"; }
    if (submit) { EnsureFront(WindowOf[r]); try { el.SetFocus(); } catch { } SendKeys.SendWait("{ENTER}"); }
    return "Em \"" + el.Current.Name + "\" (" + r + ") " + how + " o texto" + (submit ? " e apertei Enter" : "") + ".";
  }

  // A grid the program does not show to UI Automation (Access's datasheet hides its cells): copied the
  // way a person would (Ctrl+A, Ctrl+C), read from the clipboard as text, and the clipboard put back.
  [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();

  // The clipboard is never cleared or kept by this program: clearing made it the clipboard's owner,
  // and the other program's copy waited on it (this thread was asleep, not answering Windows) until
  // it gave up — nothing was ever copied (10/10/2026). The copy is detected by the clipboard's change
  // counter, Windows messages are answered while waiting, and the person's text goes back flushed, so
  // no later Ctrl+C of theirs waits on the Aurora.
  static string CopyFrom(AutomationElement window, bool all) {
    string saved = null;
    try { if (Clipboard.ContainsText()) saved = Clipboard.GetText(); } catch { }
    EnsureFront(window);
    uint before = GetClipboardSequenceNumber();
    if (all) SendKeys.SendWait("^a");
    SendKeys.SendWait("^c");
    string text = null, formats = "";
    for (int i = 0; i < 40 && string.IsNullOrEmpty(text); i++) {
      for (int j = 0; j < 10; j++) { Application.DoEvents(); Thread.Sleep(10); }
      if (GetClipboardSequenceNumber() == before) continue;
      try {
        var data = Clipboard.GetDataObject();
        if (data == null) continue;
        formats = string.Join(", ", data.GetFormats());
        foreach (var f in new[] { DataFormats.UnicodeText, DataFormats.Text, "Csv" }) {
          if (!data.GetDataPresent(f)) continue;
          var value = data.GetData(f);
          if (value is System.IO.Stream) { using (var reader = new System.IO.StreamReader((System.IO.Stream)value, Encoding.Default)) text = reader.ReadToEnd(); }
          else text = value as string;
          if (!string.IsNullOrEmpty(text)) break;
        }
      } catch { }
    }
    // Put back, flushed (copy: true): the data stays and this program is not its owner afterwards.
    try { if (saved != null) Clipboard.SetDataObject(saved, true); } catch { }
    if (string.IsNullOrEmpty(text)) return "Nada foi copiado" + (formats.Length > 0 ? " (a área de transferência recebeu: " + formats + ")" : "") + ": clique antes na grade ou na tabela (desktop_click) e tente de novo.";
    var lines = text.Replace("\r\n", "\n").TrimEnd('\n').Split('\n');
    var sb = new StringBuilder("Copiado de \"" + window.Current.Name + "\" (" + lines.Length + " linha(s)):\n");
    for (int i = 0; i < lines.Length && i < 400; i++) sb.Append(lines[i].Replace("\t", " | ")).Append('\n');
    if (lines.Length > 400) sb.Append("… (mais " + (lines.Length - 400) + " linha(s))\n");
    return sb.ToString();
  }

  // An Access file read and written directly (ACE OLEDB, which comes with Office): the tables, a
  // SELECT, or a change. Faster and surer than the screen for "me traz os clientes" or "cadastra".
  static System.Data.OleDb.OleDbConnection Open(string path) {
    var c = new System.Data.OleDb.OleDbConnection("Provider=Microsoft.ACE.OLEDB.16.0;Data Source=" + path + ";Persist Security Info=False;");
    c.Open();
    return c;
  }
  static string DbTables(string path) {
    using (var c = Open(path)) {
      var tables = c.GetOleDbSchemaTable(System.Data.OleDb.OleDbSchemaGuid.Tables, new object[] { null, null, null, "TABLE" });
      var sb = new StringBuilder("Tabelas de " + System.IO.Path.GetFileName(path) + ":\n");
      foreach (System.Data.DataRow t in tables.Rows) {
        string name = Convert.ToString(t["TABLE_NAME"]);
        var cols = c.GetOleDbSchemaTable(System.Data.OleDb.OleDbSchemaGuid.Columns, new object[] { null, null, name, null });
        var names = new List<KeyValuePair<int, string>>();
        // With its type: a yes/no column compared with 'Sim' failed, and the model fell back to reading
        // the .accdb as text (10/10/2026).
        foreach (System.Data.DataRow col in cols.Rows) {
          int type = Convert.ToInt32(col["DATA_TYPE"]);
          string label = type == 11 ? "sim/não: True/False" : type == 7 ? "data: #2026-10-31#" : type == 6 ? "moeda" : (type == 2 || type == 3 || type == 4 || type == 5 || type == 17 || type == 20 || type == 131) ? "número" : "texto";
          names.Add(new KeyValuePair<int, string>(Convert.ToInt32(col["ORDINAL_POSITION"]), Convert.ToString(col["COLUMN_NAME"]) + " (" + label + ")"));
        }
        names.Sort((a, b) => a.Key.CompareTo(b.Key));
        int rows = 0;
        using (var cmd = new System.Data.OleDb.OleDbCommand("SELECT COUNT(*) FROM [" + name + "]", c)) { try { rows = Convert.ToInt32(cmd.ExecuteScalar()); } catch { } }
        sb.Append("- " + name + " (" + rows + " linha(s)): " + string.Join(", ", names.ConvertAll(n => n.Value)) + "\n");
      }
      return sb.ToString();
    }
  }
  static string Cell(object v) {
    if (v == null || v is DBNull) return "";
    if (v is DateTime) { var d = (DateTime)v; return d.TimeOfDay.Ticks == 0 ? d.ToString("dd/MM/yyyy") : d.ToString("dd/MM/yyyy HH:mm"); }
    if (v is decimal || v is double || v is float) return Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture);
    return Convert.ToString(v).Replace("\r", " ").Replace("\n", " ").Replace("|", "/");
  }
  static string DbQuery(string path, string sql) {
    using (var c = Open(path))
    using (var cmd = new System.Data.OleDb.OleDbCommand(sql, c))
    using (var r = cmd.ExecuteReader()) {
      var sb = new StringBuilder();
      var head = new List<string>();
      for (int i = 0; i < r.FieldCount; i++) head.Add(r.GetName(i));
      sb.Append(string.Join(" | ", head)).Append('\n');
      int n = 0;
      while (r.Read()) {
        if (n < 500) { var row = new List<string>(); for (int i = 0; i < r.FieldCount; i++) row.Add(Cell(r.GetValue(i))); sb.Append(string.Join(" | ", row)).Append('\n'); }
        n++;
      }
      if (n > 500) sb.Append("… (mais " + (n - 500) + " linha(s); use WHERE para filtrar)\n");
      sb.Append("(" + n + " linha(s))");
      return sb.ToString();
    }
  }
  static string DbExec(string path, string sql) {
    using (var c = Open(path))
    using (var cmd = new System.Data.OleDb.OleDbCommand(sql, c)) {
      int changed = cmd.ExecuteNonQuery();
      return "Feito: " + changed + " linha(s) alterada(s) em " + System.IO.Path.GetFileName(path) + ".";
    }
  }

  [STAThread]
  static void Main() {
    Console.InputEncoding = Encoding.UTF8;
    Console.OutputEncoding = new UTF8Encoding(false);
    var json = new JavaScriptSerializer();
    string line;
    while ((line = Console.In.ReadLine()) != null) {
      var reply = new Dictionary<string, object>();
      try {
        var req = json.Deserialize<Dictionary<string, object>>(line);
        object id; req.TryGetValue("id", out id); reply["id"] = id;
        Func<string, string> str = k => { object v; return req.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : null; };
        string cmd = str("cmd");
        if (cmd == "ping") reply["text"] = "ok";
        else if (cmd == "windows") {
          var items = new List<string>();
          foreach (var w in TopWindows()) items.Add("- \"" + w.Current.Name + "\" [programa: " + Proc(w) + "]");
          reply["text"] = items.Count > 0 ? "Janelas abertas:\n" + string.Join("\n", items) : "Nenhuma janela aberta.";
        } else if (cmd == "snapshot") {
          var w = FindWindow(str("window"));
          int max = 250; int.TryParse(str("max") ?? "250", out max);
          reply["text"] = Snapshot(w, max); reply["window"] = w.Current.Name;
        } else if (cmd == "click") { string r = str("ref"); reply["text"] = Click(r); reply["window"] = WindowOf[r].Current.Name; }
        else if (cmd == "type") { string r = str("ref"); reply["text"] = TypeIn(r, str("text") ?? "", str("submit") == "True"); reply["window"] = WindowOf[r].Current.Name; }
        else if (cmd == "key") {
          if (string.IsNullOrEmpty(str("window"))) throw new Exception("Diga a janela (window) que deve receber as teclas.");
          EnsureFront(FindWindow(str("window")));
          SendKeys.SendWait(str("keys") ?? "");
          reply["text"] = "Apertei " + str("keys") + ".";
        } else if (cmd == "copy") { var w = FindWindow(str("window")); reply["text"] = CopyFrom(w, str("all") != "False"); reply["window"] = w.Current.Name; }
        else if (cmd == "db_tables") reply["text"] = DbTables(str("path"));
        else if (cmd == "db_query") reply["text"] = DbQuery(str("path"), str("sql"));
        else if (cmd == "db_exec") reply["text"] = DbExec(str("path"), str("sql"));
        else throw new Exception("Comando desconhecido: " + cmd);
        reply["ok"] = true;
      } catch (Exception e) {
        reply["ok"] = false;
        reply["error"] = e.Message;
      }
      Console.Out.WriteLine(json.Serialize(reply));
      Console.Out.Flush();
    }
  }
}
