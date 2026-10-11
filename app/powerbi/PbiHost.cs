// Aurora's Power BI helper: the semantic model through the Power BI Desktop's own libraries (TOM for the
// model, ADOMD for DAX, the TMDL serializer for projects). Compiled on the person's computer against the
// installed Power BI (app/powerbi.js), the same way as UiaHost. One JSON request per line on stdin, one
// reply per line on stdout. Arg 0: the Power BI "bin" folder, where the libraries are loaded from.
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text;
using System.Web.Script.Serialization;

static class Program {
  static string bin;
  [STAThread]
  static void Main(string[] args) {
    bin = args.Length > 0 ? args[0] : "";
    // The libraries live in the Power BI folder: loaded from there before any of their types is touched.
    AppDomain.CurrentDomain.AssemblyResolve += (s, e) => {
      var p = Path.Combine(bin, new AssemblyName(e.Name).Name + ".dll");
      return File.Exists(p) ? Assembly.LoadFrom(p) : null;
    };
    Console.OutputEncoding = new UTF8Encoding(false);
    Loop();
  }
  [MethodImpl(MethodImplOptions.NoInlining)]
  static void Loop() { Pbi.Serve(); }
}

static class Pbi {
  static readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 200 };
  static Microsoft.AnalysisServices.Tabular.Server server;
  static Microsoft.AnalysisServices.Tabular.Database db;
  static int port;

  public static void Serve() {
    var stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
    string line;
    while ((line = stdin.ReadLine()) != null) {
      var reply = new Dictionary<string, object>();
      try {
        var req = json.Deserialize<Dictionary<string, object>>(line);
        reply["id"] = req.ContainsKey("id") ? req["id"] : null;
        Handle(Convert.ToString(req["cmd"]), req, reply);
        reply["ok"] = true;
      } catch (Exception e) {
        reply["ok"] = false;
        var inner = e; while (inner.InnerException != null && inner is TargetInvocationException) inner = inner.InnerException;
        reply["error"] = inner.Message;
      }
      Console.WriteLine(json.Serialize(reply));
      Console.Out.Flush();
    }
  }

  static string Str(Dictionary<string, object> d, string k, string fallback = "") { object v; return d != null && d.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : fallback; }
  static List<Dictionary<string, object>> List(Dictionary<string, object> d, string k) {
    var list = new List<Dictionary<string, object>>();
    object v;
    if (d != null && d.TryGetValue(k, out v) && v is System.Collections.IList) foreach (var item in (System.Collections.IList)v) if (item is Dictionary<string, object>) list.Add((Dictionary<string, object>)item);
    return list;
  }

  static void Handle(string cmd, Dictionary<string, object> req, Dictionary<string, object> reply) {
    switch (cmd) {
      case "instances": reply["instances"] = Instances(); break;
      case "connect": Connect(int.Parse(Str(req, "port"))); reply["text"] = Describe(false); break;
      case "model": NeedModel(); db.Refresh(true); reply["text"] = Describe(Str(req, "full") == "True"); break;
      case "query": reply["text"] = Query(Str(req, "dax"), int.Parse(Str(req, "max", "50"))); break;
      case "apply": reply["text"] = Apply(List(req, "ops")); break;
      case "refresh": reply["text"] = RefreshModel(Str(req, "table")); break;
      case "build": reply["text"] = Build(req); break;
      case "disconnect": Disconnect(); reply["text"] = "ok"; break;
      default: throw new Exception("Comando desconhecido: " + cmd);
    }
  }

  // ---- The open Power BI Desktop files: each has its own local Analysis Services, with its port in a file
  // of its workspace folder; the window title comes from the parent PBIDesktop process.
  // The workspace folder is in each engine's command line (-s "…\Data"); its port in msmdsrv.port.txt
  // there (the Store version keeps them under the user profile, the installer one under AppData).
  static List<Dictionary<string, object>> Instances() {
    var found = new List<Dictionary<string, object>>();
    using (var search = new System.Management.ManagementObjectSearcher("SELECT ProcessId, ParentProcessId, CommandLine FROM Win32_Process WHERE Name = 'msmdsrv.exe'")) {
      foreach (System.Management.ManagementObject proc in search.Get()) {
        var m = System.Text.RegularExpressions.Regex.Match(Convert.ToString(proc["CommandLine"]) ?? "", "-s \"([^\"]+)\"");
        if (!m.Success) continue;
        string portFile = Path.Combine(m.Groups[1].Value, "msmdsrv.port.txt");
        int p;
        if (!File.Exists(portFile) || !int.TryParse(File.ReadAllText(portFile, Encoding.Unicode).Trim('\0', ' ', '\r', '\n', '﻿'), out p)) continue;
        string title = "";
        int parent = Convert.ToInt32(proc["ParentProcessId"]);
        try { title = System.Diagnostics.Process.GetProcessById(parent).MainWindowTitle; } catch { }
        if (!PortOpen(p)) continue;
        found.Add(new Dictionary<string, object> { { "port", p }, { "title", title }, { "pid", parent } });
      }
    }
    return found;
  }
  static bool PortOpen(int p) {
    try { using (var c = new System.Net.Sockets.TcpClient()) { var r = c.BeginConnect("127.0.0.1", p, null, null); bool ok = r.AsyncWaitHandle.WaitOne(500); if (ok) c.EndConnect(r); return ok; } } catch { return false; }
  }

  static void Connect(int p) {
    Disconnect();
    server = new Microsoft.AnalysisServices.Tabular.Server();
    server.Connect("Data Source=localhost:" + p);
    if (server.Databases.Count == 0) throw new Exception("O Power BI aberto ainda não tem modelo carregado.");
    db = server.Databases[0];
    port = p;
  }
  static void Disconnect() {
    try { if (server != null) server.Disconnect(); } catch { }
    server = null; db = null; port = 0;
  }
  static void NeedModel() { if (db == null) throw new Exception("Não estou ligada a nenhum Power BI aberto. Use powerbi com action=connect."); }
  static bool Internal(Microsoft.AnalysisServices.Tabular.Table t) { return t.Name.StartsWith("LocalDateTable_") || t.Name.StartsWith("DateTableTemplate_"); }

  static string Describe(bool full) {
    NeedModel();
    var m = db.Model;
    var sb = new StringBuilder("Modelo semântico \"" + db.Name + "\" (Power BI na porta " + port + "):\n");
    foreach (var t in m.Tables) {
      if (Internal(t)) continue;
      bool calc = false;
      foreach (var part in t.Partitions) if (part.SourceType == Microsoft.AnalysisServices.Tabular.PartitionSourceType.Calculated) calc = true;
      sb.Append("\nTabela ").Append(t.Name).Append(calc ? " (calculada)" : "").Append(t.IsHidden ? " [oculta]" : "").Append(":\n  colunas: ");
      var cols = new List<string>();
      foreach (var c in t.Columns) {
        if (c.Type == Microsoft.AnalysisServices.Tabular.ColumnType.RowNumber) continue;
        string kind = c.DataType.ToString().Replace("Int64", "inteiro").Replace("Double", "número").Replace("Decimal", "decimal").Replace("String", "texto").Replace("DateTime", "data").Replace("Boolean", "sim/não");
        string extra = c is Microsoft.AnalysisServices.Tabular.CalculatedColumn ? " = " + ((Microsoft.AnalysisServices.Tabular.CalculatedColumn)c).Expression : "";
        cols.Add(c.Name + " (" + kind + (c.IsHidden ? ", oculta" : "") + ")" + (full ? extra : ""));
      }
      sb.Append(string.Join(", ", cols)).Append('\n');
      foreach (var ms in t.Measures) sb.Append("  medida [").Append(ms.Name).Append("] = ").Append(full ? ms.Expression.Replace("\n", " ") : Short(ms.Expression)).Append(string.IsNullOrEmpty(ms.FormatString) ? "" : "  (formato " + ms.FormatString + ")").Append('\n');
    }
    if (m.Relationships.Count > 0) {
      sb.Append("\nRelações:\n");
      foreach (Microsoft.AnalysisServices.Tabular.SingleColumnRelationship r in m.Relationships) {
        if (Internal(r.ToTable) || Internal(r.FromTable)) continue;
        sb.Append("  ").Append(r.FromTable.Name).Append("[").Append(r.FromColumn.Name).Append("] ").Append(r.FromCardinality == Microsoft.AnalysisServices.Tabular.RelationshipEndCardinality.Many ? "*" : "1").Append("→").Append(r.ToCardinality == Microsoft.AnalysisServices.Tabular.RelationshipEndCardinality.Many ? "*" : "1").Append(" ").Append(r.ToTable.Name).Append("[").Append(r.ToColumn.Name).Append("]").Append(r.IsActive ? "" : " (inativa)").Append(r.CrossFilteringBehavior == Microsoft.AnalysisServices.Tabular.CrossFilteringBehavior.BothDirections ? " (filtro nos dois sentidos)" : "").Append('\n');
      }
    }
    return sb.ToString();
  }
  static string Short(string s) { s = (s ?? "").Replace("\r", " ").Replace("\n", " "); return s.Length > 120 ? s.Substring(0, 120) + "…" : s; }

  // ---- DAX
  static string Query(string dax, int max) {
    if (port == 0) throw new Exception("Não estou ligada a nenhum Power BI aberto. Use powerbi com action=connect.");
    var rows = QueryRows(dax, max + 1);
    var sb = new StringBuilder();
    if (rows.Count == 0) return "(a consulta não devolveu colunas)";
    for (int i = 0; i < rows.Count && i <= max; i++) sb.Append(string.Join(" | ", rows[i])).Append('\n');
    if (rows.Count > max + 1) sb.Append("… (mais linhas)\n");
    return (rows.Count - 1) + " linha(s):\n" + sb.ToString();
  }
  static List<string[]> QueryRows(string dax, int max) {
    var rows = new List<string[]>();
    using (var c = new Microsoft.AnalysisServices.AdomdClient.AdomdConnection("Data Source=localhost:" + port)) {
      c.Open();
      using (var cmd = new Microsoft.AnalysisServices.AdomdClient.AdomdCommand(dax, c))
      using (var r = cmd.ExecuteReader()) {
        var header = new string[r.FieldCount];
        for (int i = 0; i < r.FieldCount; i++) { string n = r.GetName(i); int b = n.LastIndexOf('['); header[i] = b >= 0 ? n.Substring(b + 1).TrimEnd(']') : n; }
        rows.Add(header);
        var br = new System.Globalization.CultureInfo("pt-BR");
        while (r.Read() && rows.Count <= max) {
          var row = new string[r.FieldCount];
          for (int i = 0; i < r.FieldCount; i++) {
            object v = r.IsDBNull(i) ? null : r.GetValue(i);
            row[i] = v == null ? "" : v is DateTime ? ((DateTime)v).ToString("dd/MM/yyyy") : v is double || v is decimal || v is float ? Convert.ToDouble(v).ToString("#,0.##", br) : Convert.ToString(v, br);
          }
          rows.Add(row);
        }
      }
    }
    return rows;
  }

  // ---- Changes to the open model, each measure checked with DAX afterwards; a measure that fails is
  // undone, so the person's report never keeps a broken one.
  static Microsoft.AnalysisServices.Tabular.Table T(string name) {
    var t = db.Model.Tables.Find(name);
    if (t == null) throw new Exception("Não há tabela \"" + name + "\" no modelo.");
    return t;
  }
  static Microsoft.AnalysisServices.Tabular.Column C(string table, string name) {
    var c = T(table).Columns.Find(name);
    if (c == null) throw new Exception("Não há coluna \"" + name + "\" em " + table + ".");
    return c;
  }
  // "Vendas[Data]" -> (Vendas, Data)
  static string[] Ref(string text) {
    var m = System.Text.RegularExpressions.Regex.Match(text ?? "", @"^\s*'?([^'\[]+?)'?\s*\[([^\]]+)\]\s*$");
    if (!m.Success) throw new Exception("Use Tabela[Coluna], como Vendas[Data]: \"" + text + "\".");
    return new[] { m.Groups[1].Value.Trim(), m.Groups[2].Value.Trim() };
  }
  static Microsoft.AnalysisServices.Tabular.DataType Dt(string t) {
    switch ((t ?? "").ToLowerInvariant()) {
      case "inteiro": case "int64": case "int": return Microsoft.AnalysisServices.Tabular.DataType.Int64;
      case "numero": case "número": case "double": case "decimal": case "moeda": return Microsoft.AnalysisServices.Tabular.DataType.Double;
      case "data": case "datetime": case "date": return Microsoft.AnalysisServices.Tabular.DataType.DateTime;
      case "sim/não": case "boolean": case "bool": return Microsoft.AnalysisServices.Tabular.DataType.Boolean;
      default: return Microsoft.AnalysisServices.Tabular.DataType.String;
    }
  }

  static string Apply(List<Dictionary<string, object>> ops) {
    NeedModel();
    db.Refresh(true);
    var m = db.Model;
    var done = new List<string>();
    var check = new List<KeyValuePair<Microsoft.AnalysisServices.Tabular.Measure, string>>(); // measure, previous expression (null = new)
    foreach (var op in ops) {
      string kind = Str(op, "op");
      if (kind == "measure") {
        // No table said (or one that is not there): where the measures already are, the fact table.
        Microsoft.AnalysisServices.Tabular.Table home = null;
        foreach (var other in m.Tables) if (home == null || other.Measures.Count > home.Measures.Count) home = other;
        string asked = Str(op, "table");
        var t = (string.IsNullOrEmpty(asked) || m.Tables.Find(asked) == null) && home != null && home.Measures.Count > 0 ? home : T(asked);
        string name = Str(op, "name");
        var ms = t.Measures.Find(name);
        string before = null;
        if (ms == null) {
          foreach (var other in m.Tables) if (other.Measures.Find(name) != null) throw new Exception("Já existe a medida [" + name + "] em " + other.Name + ".");
          ms = new Microsoft.AnalysisServices.Tabular.Measure { Name = name };
          t.Measures.Add(ms);
        } else before = ms.Expression;
        ms.Expression = Str(op, "expression");
        if (op.ContainsKey("format")) ms.FormatString = Str(op, "format");
        if (op.ContainsKey("folder")) ms.DisplayFolder = Str(op, "folder");
        if (op.ContainsKey("description")) ms.Description = Str(op, "description");
        check.Add(new KeyValuePair<Microsoft.AnalysisServices.Tabular.Measure, string>(ms, before));
        done.Add((before == null ? "criei" : "alterei") + " a medida [" + name + "]");
      } else if (kind == "column") {
        var t = T(Str(op, "table"));
        string name = Str(op, "name");
        var existing = t.Columns.Find(name) as Microsoft.AnalysisServices.Tabular.CalculatedColumn;
        if (t.Columns.Find(name) != null && existing == null) throw new Exception("A coluna " + name + " já existe e vem dos dados; escolha outro nome.");
        var col = existing ?? new Microsoft.AnalysisServices.Tabular.CalculatedColumn { Name = name };
        col.Expression = Str(op, "expression");
        if (op.ContainsKey("format")) col.FormatString = Str(op, "format");
        if (existing == null) t.Columns.Add(col);
        done.Add((existing == null ? "criei" : "alterei") + " a coluna " + t.Name + "[" + name + "]");
      } else if (kind == "table") {
        string name = Str(op, "name");
        if (m.Tables.Find(name) != null) throw new Exception("Já existe a tabela " + name + ".");
        var t = new Microsoft.AnalysisServices.Tabular.Table { Name = name };
        t.Partitions.Add(new Microsoft.AnalysisServices.Tabular.Partition { Name = name, Source = new Microsoft.AnalysisServices.Tabular.CalculatedPartitionSource { Expression = Str(op, "expression") } });
        m.Tables.Add(t);
        done.Add("criei a tabela calculada " + name);
      } else if (kind == "relationship") {
        var from = Ref(Str(op, "from")); var to = Ref(Str(op, "to"));
        var r = new Microsoft.AnalysisServices.Tabular.SingleColumnRelationship {
          Name = Guid.NewGuid().ToString(), FromColumn = C(from[0], from[1]), ToColumn = C(to[0], to[1]),
          FromCardinality = Str(op, "cardinality") == "1:1" ? Microsoft.AnalysisServices.Tabular.RelationshipEndCardinality.One : Microsoft.AnalysisServices.Tabular.RelationshipEndCardinality.Many,
          ToCardinality = Microsoft.AnalysisServices.Tabular.RelationshipEndCardinality.One,
          CrossFilteringBehavior = Str(op, "both") == "True" ? Microsoft.AnalysisServices.Tabular.CrossFilteringBehavior.BothDirections : Microsoft.AnalysisServices.Tabular.CrossFilteringBehavior.OneDirection,
          IsActive = Str(op, "active", "True") != "False",
        };
        m.Relationships.Add(r);
        done.Add("liguei " + Str(op, "from") + " → " + Str(op, "to"));
      } else if (kind == "format") {
        var c = C(Str(op, "table"), Str(op, "column"));
        if (op.ContainsKey("format")) c.FormatString = Str(op, "format");
        if (op.ContainsKey("summarize")) c.SummarizeBy = Str(op, "summarize") == "none" ? Microsoft.AnalysisServices.Tabular.AggregateFunction.None : Microsoft.AnalysisServices.Tabular.AggregateFunction.Sum;
        if (op.ContainsKey("sortBy")) c.SortByColumn = C(Str(op, "table"), Str(op, "sortBy"));
        if (op.ContainsKey("hidden")) c.IsHidden = Str(op, "hidden") == "True";
        if (op.ContainsKey("category")) c.DataCategory = Str(op, "category");
        done.Add("ajustei " + Str(op, "table") + "[" + Str(op, "column") + "]");
      } else if (kind == "hide") {
        if (op.ContainsKey("column")) C(Str(op, "table"), Str(op, "column")).IsHidden = Str(op, "hidden", "True") != "False";
        else T(Str(op, "table")).IsHidden = Str(op, "hidden", "True") != "False";
        done.Add((Str(op, "hidden", "True") != "False" ? "ocultei " : "mostrei ") + Str(op, "table") + (op.ContainsKey("column") ? "[" + Str(op, "column") + "]" : ""));
      } else if (kind == "markDate") {
        var t = T(Str(op, "table"));
        t.DataCategory = "Time";
        C(t.Name, Str(op, "column")).IsKey = true;
        done.Add("marquei " + t.Name + " como tabela de datas");
      } else if (kind == "rename") {
        string table = Str(op, "table"), name = Str(op, "name"), to = Str(op, "to");
        var ms = T(table).Measures.Find(name);
        if (ms != null) ms.Name = to; else C(table, name).Name = to;
        done.Add("renomeei " + name + " para " + to);
      } else if (kind == "delete") {
        string table = Str(op, "table"), name = Str(op, "name");
        var t = T(table);
        var ms = t.Measures.Find(name);
        if (ms != null) t.Measures.Remove(ms);
        else { var col = t.Columns.Find(name) as Microsoft.AnalysisServices.Tabular.CalculatedColumn; if (col == null) throw new Exception("Só apago medidas e colunas calculadas; \"" + name + "\" não é uma delas."); t.Columns.Remove(col); }
        done.Add("apaguei " + table + "[" + name + "]");
      } else throw new Exception("op desconhecida: " + kind + " (measure, column, table, relationship, format, hide, markDate, rename, delete).");
    }
    m.SaveChanges();
    // Each measure computed once: an error undoes it and goes back with its message.
    var errors = new List<string>();
    var results = new List<string>();
    foreach (var kv in check) {
      try {
        var rows = QueryRows("EVALUATE ROW(\"v\", [" + kv.Key.Name.Replace("]", "]]") + "])", 2);
        results.Add("[" + kv.Key.Name + "] = " + (rows.Count > 1 ? rows[1][0] : "(vazio)"));
      } catch (Exception e) {
        errors.Add("[" + kv.Key.Name + "]: " + e.Message);
        if (kv.Value == null) kv.Key.Table.Measures.Remove(kv.Key); else kv.Key.Expression = kv.Value;
      }
    }
    // A measure that saved but cannot be computed is also flagged by the engine on the object itself.
    if (errors.Count > 0) m.SaveChanges();
    var sb = new StringBuilder();
    if (done.Count > 0) sb.Append("Feito: ").Append(string.Join("; ", done)).Append(".\n");
    if (results.Count > 0) sb.Append("Valores agora (sem filtros): ").Append(string.Join("; ", results)).Append(".\n");
    if (errors.Count > 0) sb.Append("Desfiz porque deu erro no DAX: ").Append(string.Join(" | ", errors)).Append("\nCorrija a expressão e mande de novo.\n");
    return sb.ToString();
  }

  static string RefreshModel(string table) {
    NeedModel();
    db.Refresh(true);
    if (string.IsNullOrEmpty(table)) db.Model.RequestRefresh(Microsoft.AnalysisServices.Tabular.RefreshType.Full);
    else T(table).RequestRefresh(Microsoft.AnalysisServices.Tabular.RefreshType.Full);
    db.Model.SaveChanges();
    var sb = new StringBuilder("Atualizei os dados. Linhas por tabela: ");
    var counts = new List<string>();
    foreach (var t in db.Model.Tables) {
      if (Internal(t)) continue;
      try { var rows = QueryRows("EVALUATE ROW(\"n\", COUNTROWS('" + t.Name.Replace("'", "''") + "'))", 2); counts.Add(t.Name + " " + (rows.Count > 1 ? rows[1][0] : "0")); } catch (Exception e) { counts.Add(t.Name + " (erro: " + e.Message + ")"); }
    }
    return sb.Append(string.Join(", ", counts)).Append('.').ToString();
  }

  // ---- A new semantic model, from the design made in app/powerbiDesign.js, written as TMDL into the
  // project folder (X.SemanticModel/definition) by the Power BI's own serializer.
  static string Build(Dictionary<string, object> req) {
    var spec = req["model"] as Dictionary<string, object>;
    string folder = Str(req, "folder");
    var database = new Microsoft.AnalysisServices.Tabular.Database {
      Name = Str(spec, "name", "Modelo"), ID = Str(spec, "name", "Modelo"),
      CompatibilityLevel = 1600,
      StorageEngineUsed = Microsoft.AnalysisServices.StorageEngineUsed.TabularMetadata,
    };
    var model = new Microsoft.AnalysisServices.Tabular.Model {
      Name = "Model", Culture = Str(spec, "culture", "pt-BR"),
      DefaultPowerBIDataSourceVersion = Microsoft.AnalysisServices.Tabular.PowerBIDataSourceVersion.PowerBI_V3,
      DiscourageImplicitMeasures = true,
    };
    database.Model = model;
    model.Annotations.Add(new Microsoft.AnalysisServices.Tabular.Annotation { Name = "__PBI_TimeIntelligenceEnabled", Value = "0" });
    foreach (var ts in List(spec, "tables")) {
      var t = new Microsoft.AnalysisServices.Tabular.Table { Name = Str(ts, "name") };
      if (Str(ts, "hidden") == "True") t.IsHidden = true;
      bool calc = ts.ContainsKey("dax");
      foreach (var cs in List(ts, "columns")) {
        Microsoft.AnalysisServices.Tabular.Column c;
        if (cs.ContainsKey("expression")) c = new Microsoft.AnalysisServices.Tabular.CalculatedColumn { Name = Str(cs, "name"), Expression = Str(cs, "expression"), DataType = Dt(Str(cs, "type")) };
        else if (calc) c = new Microsoft.AnalysisServices.Tabular.CalculatedTableColumn { Name = Str(cs, "name"), SourceColumn = "[" + Str(cs, "source", Str(cs, "name")) + "]", DataType = Dt(Str(cs, "type")), IsNameInferred = false, IsDataTypeInferred = false };
        else c = new Microsoft.AnalysisServices.Tabular.DataColumn { Name = Str(cs, "name"), SourceColumn = Str(cs, "name"), DataType = Dt(Str(cs, "type")) };
        if (cs.ContainsKey("format")) c.FormatString = Str(cs, "format");
        c.SummarizeBy = Str(cs, "summarize") == "sum" ? Microsoft.AnalysisServices.Tabular.AggregateFunction.Sum : Microsoft.AnalysisServices.Tabular.AggregateFunction.None;
        if (Str(cs, "hidden") == "True") c.IsHidden = true;
        if (cs.ContainsKey("category")) c.DataCategory = Str(cs, "category");
        if (Str(cs, "key") == "True") c.IsKey = true;
        if (cs.ContainsKey("folder")) c.DisplayFolder = Str(cs, "folder");
        t.Columns.Add(c);
      }
      foreach (var cs in List(ts, "columns")) if (cs.ContainsKey("sortBy")) t.Columns[Str(cs, "name")].SortByColumn = t.Columns[Str(cs, "sortBy")];
      if (calc) t.Partitions.Add(new Microsoft.AnalysisServices.Tabular.Partition { Name = t.Name, Source = new Microsoft.AnalysisServices.Tabular.CalculatedPartitionSource { Expression = Str(ts, "dax") } });
      else t.Partitions.Add(new Microsoft.AnalysisServices.Tabular.Partition { Name = t.Name, Mode = Microsoft.AnalysisServices.Tabular.ModeType.Import, Source = new Microsoft.AnalysisServices.Tabular.MPartitionSource { Expression = Str(ts, "m") } });
      if (Str(ts, "dateTable") == "True") t.DataCategory = "Time";
      foreach (var ms in List(ts, "measures")) {
        var measure = new Microsoft.AnalysisServices.Tabular.Measure { Name = Str(ms, "name"), Expression = Str(ms, "expression") };
        if (ms.ContainsKey("format")) measure.FormatString = Str(ms, "format");
        if (ms.ContainsKey("folder")) measure.DisplayFolder = Str(ms, "folder");
        if (ms.ContainsKey("description")) measure.Description = Str(ms, "description");
        t.Measures.Add(measure);
      }
      model.Tables.Add(t);
    }
    foreach (var rs in List(spec, "relationships")) {
      var from = Ref(Str(rs, "from")); var to = Ref(Str(rs, "to"));
      model.Relationships.Add(new Microsoft.AnalysisServices.Tabular.SingleColumnRelationship {
        Name = Guid.NewGuid().ToString(),
        FromColumn = model.Tables[from[0]].Columns[from[1]], ToColumn = model.Tables[to[0]].Columns[to[1]],
        FromCardinality = Microsoft.AnalysisServices.Tabular.RelationshipEndCardinality.Many, ToCardinality = Microsoft.AnalysisServices.Tabular.RelationshipEndCardinality.One,
        CrossFilteringBehavior = Microsoft.AnalysisServices.Tabular.CrossFilteringBehavior.OneDirection,
      });
    }
    string definition = Path.Combine(folder, "definition");
    if (Directory.Exists(definition)) Directory.Delete(definition, true);
    Microsoft.AnalysisServices.Tabular.TmdlSerializer.SerializeDatabaseToFolder(database, definition);
    // Read back: the same serializer must accept what it wrote.
    Microsoft.AnalysisServices.Tabular.TmdlSerializer.DeserializeDatabaseFromFolder(definition);
    return "Modelo semântico gravado em " + definition + " (" + model.Tables.Count + " tabelas, " + model.Relationships.Count + " relações).";
  }
}
