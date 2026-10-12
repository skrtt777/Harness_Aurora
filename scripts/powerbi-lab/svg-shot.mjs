// Uma cena SVG salva pelo laboratório vira PNG na proporção certa (para olhar o desenho sem a distorção
// do box do relatório). node scripts/powerbi-lab/svg-shot.mjs <cena.svg> <saída.png> [largura]
import { readFileSync } from "node:fs";
const [file, out, width = "1400"] = process.argv.slice(2);
const svg = readFileSync(file, "utf8").replace("preserveAspectRatio='none'", "preserveAspectRatio='xMidYMid meet'");
const [, , , w, h] = /viewBox='([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)'/.exec(svg).map(Number);
const W = Number(width); const H = Math.round((W * h) / w);
const { chromium } = await import("playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.setContent(`<body style="margin:0;background:#0B1220">${svg.replace("<svg ", `<svg width='${W}' height='${H}' `)}</body>`);
await page.screenshot({ path: out });
await browser.close();
