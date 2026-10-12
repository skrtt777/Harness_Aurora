// A KPI tile drawn by a DAX measure (an SVG, like the scenes): the name, the value in its own format, the
// last month against the one before (▲/▼, green when it went the good way for that number, red the bad
// way; percentages in percentage points) and the line of the last 12 months with its last point. When
// the series is flat (a number of "now": trucks at the docks) only the name and the value.
import { daxText } from "./powerbiScene.js";

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
// Numbers where going up is bad news.
export const UP_IS_BAD = /atras|fila|aguard|sa[íi]das|custo|despesa|estour|tempo|espera|cancel|devolu|reclama|perda|chamados abertos/i;

/**
 * The DAX of the tile. measure: "[Faturamento]"; name: what it is called; format: its format string;
 * calendar: "'Calendário'" when the model has one (else no series); dark: the page's look.
 */
export function kpiTile({ measure, name, format, calendar = null, dark = false, wide = false }) {
  // Wide: 640 x 150, the line in the right half; narrow: 400 x 150, the line under the value.
  const W = wide ? 640 : 400; const LX = wide ? 330 : 14; const LW = wide ? 290 : 372; const LY = wide ? 120 : 142; const LH = wide ? 70 : 26;
  const C = dark ? { text: "#E8EDF5", soft: "#A9B8CF", line: "#4F9BFF", good: "#3DDC97", bad: "#FF8A8A", flat: "#A9B8CF" } : { text: "#1B2A4A", soft: "#5B6B85", line: "#2F6FDB", good: "#107C10", bad: "#D13438", flat: "#5B6B85" };
  const percent = /%/.test(format || "");
  const fmt = String(format || "#,0").replace(/"/g, "\"\"");
  const head = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W} 150' preserveAspectRatio='xMinYMid meet'><text x='14' y='30' font-family='Segoe UI, sans-serif' font-size='20' font-weight='600' fill='${C.soft}'>${xml(name.length > 34 ? `${name.slice(0, 33)}…` : name)}</text>`;
  const value = `"<text x='14' y='82' font-family='Segoe UI Semibold, Segoe UI, sans-serif' font-size='44' font-weight='700' fill='${C.text.replace("#", "%23")}'>" & SUBSTITUTE(SUBSTITUTE(FORMAT(V, "${fmt}"), "&", "&amp;"), "%", "%25") & "</text>"`;
  if (!calendar) return [`VAR V = ${measure}`, `RETURN ${daxText(`data:image/svg+xml;utf8,${head}`)} & IF(ISBLANK(V), "<text x='14' y='80' font-family='Segoe UI' font-size='40' fill='${C.soft.replace("#", "%23")}'>—</text>", ${value}) & "</svg>"`].join("\n");
  const bad = UP_IS_BAD.test(name);
  return [
    `VAR V = ${measure}`,
    `VAR Fim = MAX(${calendar}[Data])`,
    // The last 12 months up to the last day in view, each month's own value.
    `VAR Serie = ADDCOLUMNS(GENERATESERIES(0, 11, 1), "@v", VAR d = EOMONTH(Fim, -[Value]) RETURN CALCULATE(${measure}, REMOVEFILTERS(${calendar}), ${calendar}[Data] > EOMONTH(d, -1), ${calendar}[Data] <= d) + 0)`,
    "VAR Atual = MAXX(FILTER(Serie, [Value] = 0), [@v]) VAR Anterior = MAXX(FILTER(Serie, [Value] = 1), [@v])",
    "VAR Mx = MAXX(Serie, [@v]) VAR Mn = MINX(Serie, [@v]) VAR Plano = Mx = Mn",
    `VAR Delta = ${percent ? "(Atual - Anterior) * 100" : "DIVIDE(Atual - Anterior, ABS(Anterior))"}`,
    `VAR Cor = IF(Delta = 0, ${daxText(C.flat)}, IF((Delta > 0) <> ${bad ? "TRUE()" : "FALSE()"}, ${daxText(C.good)}, ${daxText(C.bad)}))`,
    `VAR Texto = IF(Plano || (Anterior = 0 && ${percent ? "FALSE()" : "TRUE()"}), "", IF(Delta >= 0, "▲ ", "▼ ") & ${percent ? `FORMAT(ABS(Delta), "0.0") & " p.p."` : `FORMAT(ABS(Delta), "0.0%")`} & " no último mês")`,
    `VAR Pts = CONCATENATEX(Serie, INT(${LX} + (11 - [Value]) * ${LW} / 11) & "," & INT(${LY} - DIVIDE([@v] - Mn, Mx - Mn) * ${LH}), " ", [Value], DESC)`,
    `VAR Ponta = INT(${LY} - DIVIDE(Atual - Mn, Mx - Mn) * ${LH})`,
    `RETURN ${daxText(`data:image/svg+xml;utf8,${head}`)} & IF(ISBLANK(V), "<text x='14' y='80' font-family='Segoe UI' font-size='40' fill='${C.soft.replace("#", "%23")}'>—</text>", ${value})`,
    `  & IF(Texto = "", "", "<text x='14' y='110' font-family='Segoe UI, sans-serif' font-size='17' font-weight='600' fill='" & Cor & "'>" & SUBSTITUTE(Texto, "%", "%25") & "</text>")`,
    `  & IF(Plano, "", "<polyline points='" & Pts & "' fill='none' stroke='${C.line.replace("#", "%23")}' stroke-width='2.5' stroke-linejoin='round' opacity='0.85'/><circle cx='${LX + LW}' cy='" & Ponta & "' r='4' fill='${C.line.replace("#", "%23")}'/>")`,
    "  & \"</svg>\"",
  ].join("\n");
}
