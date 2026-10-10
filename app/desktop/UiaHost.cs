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

  // A field with no name of its own takes the label just before it ("Nome" then the text box).
  static string Snapshot(AutomationElement window, int max) {
    var lines = new List<string>();
    lines.Add("Janela: " + window.Current.Name + "  [programa: " + Proc(window) + "]");
    int count = 0;
    string lastLabel = null;
    var walker = TreeWalker.ControlViewWalker;
    Action<AutomationElement, int> walk = null;
    walk = (el, depth) => {
      if (count >= max || depth > 30) return;
      AutomationElement child;
      try { child = walker.GetFirstChild(el); } catch { return; }
      while (child != null && count < max) {
        bool skip = false;
        try { skip = child.Current.IsOffscreen && Kind(child) != "Window"; } catch { skip = true; }
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
    if (count >= max) lines.Add("… (janela grande: mostrei " + max + " elementos; abra o menu ou a parte que interessa e veja de novo)");
    return string.Join("\n", lines);
  }

  static void Focus(AutomationElement window) {
    try {
      var h = new IntPtr(window.Current.NativeWindowHandle);
      if (h != IntPtr.Zero) { if (IsIconic(h)) ShowWindow(h, 9); SetForegroundWindow(h); Thread.Sleep(120); }
    } catch { }
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
    if (how == null) { try { el.SetFocus(); } catch { } SendKeys.SendWait(Escape(text)); how = "digitei"; }
    if (submit) { try { el.SetFocus(); } catch { } SendKeys.SendWait("{ENTER}"); }
    return "Em \"" + el.Current.Name + "\" (" + r + ") " + how + " o texto" + (submit ? " e apertei Enter" : "") + ".";
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
          if (!string.IsNullOrEmpty(str("window"))) Focus(FindWindow(str("window")));
          SendKeys.SendWait(str("keys") ?? "");
          reply["text"] = "Apertei " + str("keys") + ".";
        } else throw new Exception("Comando desconhecido: " + cmd);
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
