// The report side of a Power BI project (.pbip), in the PBIR format: one folder per page and per visual,
// plain JSON that Power BI Desktop opens. The model side (TMDL) is written by app/powerbi/PbiHost.cs with
// the Power BI's own serializer. Pages and visuals come from app/powerbiDesign.js.
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SCHEMA = "https://developer.microsoft.com/json-schemas/fabric";
const write = (path, data) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`); };
const id = () => randomUUID().replace(/-/g, "").slice(0, 20);
const literal = (value) => ({ expr: { Literal: { Value: typeof value === "string" ? `'${value.replace(/'/g, "''")}'` : typeof value === "boolean" ? String(value) : `${value}D` } } });
const color = (hex) => ({ solid: { color: literal(hex) } });

/** "Vendas[Produto]" or "[Total de vendas]" (a measure, with its table) -> the field of a query. */
export function field(ref, measures = {}) {
  const column = /^'?([^'[]+?)'?\[([^\]]+)\]$/.exec(String(ref).trim());
  if (column) return { kind: "column", entity: column[1], property: column[2], json: { Column: { Expression: { SourceRef: { Entity: column[1] } }, Property: column[2] } } };
  const name = String(ref).trim().replace(/^\[|\]$/g, "");
  const table = measures[name];
  if (!table) throw new Error(`Não conheço a medida [${name}].`);
  return { kind: "measure", entity: table, property: name, json: { Measure: { Expression: { SourceRef: { Entity: table } }, Property: name } } };
}
const projection = (f) => ({ field: f.json, queryRef: `${f.entity}.${f.property}`, nativeQueryRef: f.property });

// The data roles of each kind of visual.
const ROLES = {
  card: { values: "Values" },
  clusteredBarChart: { category: "Category", values: "Y", series: "Series" },
  clusteredColumnChart: { category: "Category", values: "Y", series: "Series" },
  lineChart: { category: "Category", values: "Y", series: "Series" },
  areaChart: { category: "Category", values: "Y", series: "Series" },
  donutChart: { category: "Category", values: "Y" },
  pieChart: { category: "Category", values: "Y" },
  tableEx: { values: "Values" },
  pivotTable: { rows: "Rows", columns: "Columns", values: "Values" },
  slicer: { values: "Values" },
  gauge: { values: "Y", target: "TargetValue" },
  kpi: { values: "Indicator", category: "TrendLine", target: "Goal" },
  treemap: { category: "Group", values: "Values" },
};

/**
 * One visual: { type, x, y, w, h, title?, category?, values?, series?, rows?, columns?, target?, sort?,
 * labels?, dropdown? }. Fields as "Tabela[Coluna]" or "[Medida]".
 */
export function visual(spec, measures, z = 0) {
  const name = spec.name || id();
  const container = { $schema: `${SCHEMA}/item/report/definition/visualContainer/1.0.0/schema.json`, name, position: { x: spec.x, y: spec.y, z: z * 1000, height: spec.h, width: spec.w, tabOrder: z * 1000 } };
  if (spec.type === "textbox") {
    container.visual = { visualType: "textbox", objects: { general: [{ properties: { paragraphs: spec.paragraphs } }] }, drillFilterOtherVisuals: true };
    return container;
  }
  // A picture drawn by a measure (an SVG from the data): the Image visual with its source bound to it.
  if (spec.type === "image") {
    const f = field(spec.url, measures);
    container.visual = {
      visualType: "image",
      objects: {
        image: [{ properties: { sourceType: literal("imageUrl"), sourceUrl: { expr: f.json }, ...(spec.fit ? { fit: literal(spec.fit) } : {}) } }],
        general: [{ properties: { imageUrl: { expr: f.json } } }],
      },
      visualContainerObjects: {
        ...(spec.title ? { title: [{ properties: { show: literal(true), text: literal(spec.title) } }] } : { title: [{ properties: { show: literal(false) } }] }),
        ...(spec.background ? { background: [{ properties: { show: literal(true), color: color(spec.background) } }] } : {}),
        ...(spec.border === false ? { border: [{ properties: { show: literal(false) } }] } : {}),
      },
      drillFilterOtherVisuals: true,
    };
    return container;
  }
  const roles = ROLES[spec.type];
  if (!roles) throw new Error(`Visual desconhecido: ${spec.type}`);
  const queryState = {};
  for (const [key, role] of Object.entries(roles)) {
    const refs = [spec[key]].flat().filter(Boolean);
    if (refs.length) queryState[role] = { projections: refs.map((r) => projection(field(r, measures))) };
  }
  const query = { queryState };
  if (spec.sort) {
    const f = field(spec.sort.by, measures);
    query.sortDefinition = { sort: [{ field: f.json, direction: spec.sort.desc === false ? "Ascending" : "Descending" }], isDefaultSort: true };
  }
  const objects = {};
  if (spec.labels) objects.labels = [{ properties: { show: literal(true) } }];
  if (spec.dropdown) objects.data = [{ properties: { mode: literal("Dropdown") } }];
  if (spec.type === "slicer") objects.header = [{ properties: { show: literal(true) } }];
  // A table with a picture measure (progress bars): the size of the pictures in the cells.
  if (spec.totals === false) objects.total = [{ properties: { totals: literal(false) } }];
  if (spec.image) objects.grid = [{ properties: { imageHeight: literal(spec.image.height), imageWidth: literal(spec.image.width) } }];
  // A card: the title names it, so no second label under the value; the full value ("R$ 94.419,80",
  // not "R$ 94,42 Mil").
  if (spec.type === "card") {
    objects.categoryLabels = [{ properties: { show: literal(false) } }];
    objects.labels = [{ properties: { labelDisplayUnits: literal(1), ...(spec.fontSize ? { fontSize: literal(spec.fontSize) } : {}) } }];
  }
  const visualContainerObjects = {};
  if (spec.title) visualContainerObjects.title = [{ properties: { show: literal(true), text: literal(spec.title) } }];
  container.visual = { visualType: spec.type, query, ...(Object.keys(objects).length ? { objects } : {}), ...(Object.keys(visualContainerObjects).length ? { visualContainerObjects } : {}), drillFilterOtherVisuals: true };
  return container;
}

/** The Aurora's report theme: navy and blue, light grey page, white cards with soft borders. */
export function theme(palette = {}) {
  if (palette.dark) return darkTheme(palette);
  const accent = palette.accent || "#0078D4";
  return {
    name: "Aurora",
    dataColors: [accent, "#1B2A4A", "#00B294", "#FF8C00", "#8764B8", "#E3008C", "#69797E", "#4F6BED"],
    background: "#FFFFFF", foreground: "#1B2A4A", tableAccent: accent,
    good: "#107C10", neutral: "#FFB900", bad: "#D13438", maximum: accent, center: "#FFB900", minimum: "#DEEFFF",
    textClasses: {
      callout: { fontSize: 28, fontFace: "Segoe UI Semibold", color: "#1B2A4A" },
      title: { fontSize: 12, fontFace: "Segoe UI Semibold", color: "#1B2A4A" },
      header: { fontSize: 12, fontFace: "Segoe UI Semibold", color: "#1B2A4A" },
      label: { fontSize: 10, fontFace: "Segoe UI", color: "#3B4A63" },
    },
    visualStyles: {
      "*": { "*": {
        border: [{ show: true, color: { solid: { color: "#E3E7EE" } }, radius: 8 }],
        background: [{ show: true, color: { solid: { color: "#FFFFFF" } }, transparency: 0 }],
        padding: [{ top: 10, bottom: 10, left: 12, right: 12 }],
        dropShadow: [{ show: false }],
        title: [{ show: true, fontSize: 12, fontColor: { solid: { color: "#1B2A4A" } } }],
      } },
      page: { "*": { background: [{ color: { solid: { color: "#F3F5F9" } }, transparency: 0 }], outspace: [{ color: { solid: { color: "#F3F5F9" } } }] } },
      textbox: { "*": { border: [{ show: false }], background: [{ show: false }], padding: [{ top: 0, bottom: 0, left: 4, right: 4 }] } },
      slicer: { "*": { title: [{ show: false }] } },
    },
  };
}

/** The operations theme: a dark control room (the scenes are drawn for it), bright data colours. */
function darkTheme(palette = {}) {
  const accent = palette.accent || "#4F9BFF";
  const solid = (c) => ({ solid: { color: c } });
  const PAGE = "#0B1220"; const CARD = "#111B2E"; const LINE = "#1F2C44"; const TEXT = "#E8EDF5"; const SOFT = "#A9B8CF";
  return {
    name: "Aurora Operação",
    dataColors: [accent, "#3DDC97", "#F6D365", "#C3A6FA", "#FF8A8A", "#7FD3F7", "#FFB86B", "#8FA3BF"],
    background: CARD, foreground: TEXT, backgroundLight: "#16233A", foregroundNeutralSecondary: SOFT, foregroundNeutralTertiary: "#6B7A90", backgroundNeutral: LINE, tableAccent: accent,
    good: "#3DDC97", neutral: "#F6D365", bad: "#FF8A8A", maximum: accent, center: "#F6D365", minimum: "#16233A",
    textClasses: {
      callout: { fontSize: 26, fontFace: "Segoe UI Semibold", color: TEXT },
      title: { fontSize: 12, fontFace: "Segoe UI Semibold", color: TEXT },
      header: { fontSize: 12, fontFace: "Segoe UI Semibold", color: TEXT },
      label: { fontSize: 10, fontFace: "Segoe UI", color: SOFT },
    },
    visualStyles: {
      "*": { "*": {
        border: [{ show: true, color: solid(LINE), radius: 10 }],
        background: [{ show: true, color: solid(CARD), transparency: 0 }],
        padding: [{ top: 10, bottom: 10, left: 12, right: 12 }],
        dropShadow: [{ show: false }],
        title: [{ show: true, fontSize: 12, fontColor: solid(TEXT) }],
        categoryAxis: [{ labelColor: solid(SOFT), gridlineColor: solid(LINE) }],
        valueAxis: [{ labelColor: solid(SOFT), gridlineColor: solid(LINE) }],
        legend: [{ labelColor: solid(SOFT) }],
        labels: [{ color: solid(TEXT) }],
      } },
      page: { "*": { background: [{ color: solid(PAGE), transparency: 0 }], outspace: [{ color: solid(PAGE) }] } },
      textbox: { "*": { border: [{ show: false }], background: [{ show: false }], padding: [{ top: 0, bottom: 0, left: 4, right: 4 }] } },
      slicer: { "*": { title: [{ show: false }], header: [{ fontColor: solid(SOFT) }], items: [{ fontColor: solid(TEXT), background: solid(CARD) }] } },
      tableEx: { "*": {
        columnHeaders: [{ fontColor: solid(SOFT), backColor: solid(CARD) }],
        values: [{ fontColorPrimary: solid(TEXT), backColorPrimary: solid(CARD), fontColorSecondary: solid(TEXT), backColorSecondary: solid("#0F1829") }],
        total: [{ fontColor: solid(TEXT), backColor: solid(CARD) }],
        grid: [{ gridHorizontalColor: solid(LINE), outlineColor: solid(LINE) }],
      } },
      card: { "*": { labels: [{ color: solid(TEXT) }], categoryLabels: [{ color: solid(SOFT) }] } },
    },
  };
}

/**
 * The whole report folder: X.Report/{definition.pbir, .platform, definition/…, StaticResources/…}.
 * pages: [{ displayName, visuals: [...] }]; measures: { "Nome da medida": "Tabela" }.
 */
export function writeReport(reportDir, { name, modelFolder, pages, measures, palette }) {
  rmSync(join(reportDir, "definition"), { recursive: true, force: true });
  write(join(reportDir, "definition.pbir"), { version: "4.0", datasetReference: { byPath: { path: `../${modelFolder}` } } });
  write(join(reportDir, ".platform"), { $schema: `${SCHEMA}/gitIntegration/platformProperties/2.0.0/schema.json`, metadata: { type: "Report", displayName: name }, config: { version: "2.0", logicalId: randomUUID() } });
  const def = join(reportDir, "definition");
  write(join(def, "version.json"), { $schema: `${SCHEMA}/item/report/definition/versionMetadata/1.0.0/schema.json`, version: "2.0.0" });
  write(join(def, "report.json"), {
    $schema: `${SCHEMA}/item/report/definition/report/1.0.0/schema.json`,
    themeCollection: { customTheme: { name: "AuroraTheme.json", reportVersionAtImport: "5.55", type: "RegisteredResources" } },
    layoutOptimization: "None",
    resourcePackages: [{ name: "RegisteredResources", type: "RegisteredResources", items: [{ name: "AuroraTheme.json", path: "AuroraTheme.json", type: "CustomTheme" }] }],
    settings: { useStylableVisualContainerHeader: true, defaultDrillFilterOtherVisuals: true, allowChangeFilterTypes: true, useEnhancedTooltips: true },
  });
  write(join(reportDir, "StaticResources", "RegisteredResources", "AuroraTheme.json"), theme(palette));
  const pageNames = pages.map((p, i) => p.name || `pagina${i + 1}${id().slice(0, 6)}`);
  write(join(def, "pages", "pages.json"), { $schema: `${SCHEMA}/item/report/definition/pagesMetadata/1.0.0/schema.json`, pageOrder: pageNames, activePageName: pageNames[0] });
  pages.forEach((page, i) => {
    const dir = join(def, "pages", pageNames[i]);
    write(join(dir, "page.json"), { $schema: `${SCHEMA}/item/report/definition/page/1.0.0/schema.json`, name: pageNames[i], displayName: page.displayName, displayOption: "FitToPage", height: page.height || 720, width: page.width || 1280 });
    page.visuals.forEach((spec, z) => {
      const v = visual(spec, measures, z);
      write(join(dir, "visuals", v.name, "visual.json"), v);
    });
  });
}

/** The .pbip that ties the report and the model together, and the model's own small files. */
export function writeProject(folder, name) {
  write(join(folder, `${name}.pbip`), { version: "1.0", artifacts: [{ report: { path: `${name}.Report` } }], settings: { enableAutoRecovery: true } });
  write(join(folder, `${name}.SemanticModel`, "definition.pbism"), { version: "4.2", settings: {} });
  write(join(folder, `${name}.SemanticModel`, ".platform"), { $schema: `${SCHEMA}/gitIntegration/platformProperties/2.0.0/schema.json`, metadata: { type: "SemanticModel", displayName: name }, config: { version: "2.0", logicalId: randomUUID() } });
  writeFileSync(join(folder, ".gitignore"), "**/.pbi/localSettings.json\n**/.pbi/cache.abf\n");
  return join(folder, `${name}.pbip`);
}
