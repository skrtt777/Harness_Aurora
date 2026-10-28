// The VS Code extension (vscode/aurora) as a .vsix, without vsce: a zip with the manifest VS Code reads
// (extension.vsixmanifest, [Content_Types].xml) and the extension's files under extension/ (tests and
// dotfiles left out). Goes to vscode/dist/aurora-harness.vsix, which the installer carries
// (package.json build.extraResources) and Settings → Editor de código installs.
//   node scripts/pack-vscode.mjs [--out arquivo.vsix]
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, relative, dirname, extname, resolve } from "node:path";
import { deflateRawSync, crc32 } from "node:zlib";

const src = resolve("vscode/aurora");
const pkg = JSON.parse(readFileSync(join(src, "package.json"), "utf8"));
const outArg = process.argv.indexOf("--out");
const out = outArg > 0 ? resolve(process.argv[outArg + 1]) : resolve("vscode/dist/aurora-harness.vsix");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(src, full).replace(/\\/g, "/");
    if (name.startsWith(".") || rel === "test" || rel.startsWith("test/") || name.endsWith(".vsix")) continue;
    if (statSync(full).isDirectory()) walk(full); else files.push(rel);
  }
})(src);

const TYPES = { ".js": "application/javascript", ".json": "application/json", ".md": "text/markdown", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css", ".vsixmanifest": "text/xml" };
const manifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${esc(pkg.name)}" Version="${esc(pkg.version)}" Publisher="${esc(pkg.publisher)}" />
    <DisplayName>${esc(pkg.displayName)}</DisplayName>
    <Description xml:space="preserve">${esc(pkg.description)}</Description>
    <Tags>keybindings,chat-participant,ai,autocomplete</Tags>
    <Categories>${esc(pkg.categories.join(","))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${esc(pkg.engines.vscode)}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.EnabledApiProposals" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true" />
      <Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true" />
      <Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free"/>
    </Properties>
    ${pkg.icon ? `<Icon>extension/${esc(pkg.icon)}</Icon>` : ""}
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    ${pkg.icon ? `<Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/${esc(pkg.icon)}" Addressable="true" />` : ""}
  </Assets>
</PackageManifest>`;
const exts = [...new Set([...files.map((f) => extname(f)), ".vsixmanifest"])].filter((e) => TYPES[e]);
const types = `<?xml version="1.0" encoding="utf-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${exts.map((e) => `<Default Extension="${e}" ContentType="${TYPES[e]}"/>`).join("")}</Types>`;

// A plain zip (deflate), what VS Code's installer reads.
const entries = [["extension.vsixmanifest", Buffer.from(manifest)], ["[Content_Types].xml", Buffer.from(types)], ...files.map((f) => [`extension/${f}`, readFileSync(join(src, f))])];
const parts = [], central = [];
let offset = 0;
const time = new Date(), dosTime = (time.getHours() << 11) | (time.getMinutes() << 5) | (time.getSeconds() >> 1), dosDate = ((time.getFullYear() - 1980) << 9) | ((time.getMonth() + 1) << 5) | time.getDate();
for (const [name, data] of entries) {
  // The manifest stored as is: the Harness reads the version from the .vsix's bytes (app/vscodeExtension.js).
  const stored = name === "extension.vsixmanifest";
  const nameBuf = Buffer.from(name, "utf8"), packed = stored ? data : deflateRawSync(data, { level: 9 }), crc = crc32(data), method = stored ? 0 : 8;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
  local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
  parts.push(local, nameBuf, packed);
  const head = Buffer.alloc(46);
  head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(20, 6); head.writeUInt16LE(0x0800, 8); head.writeUInt16LE(method, 10);
  head.writeUInt16LE(dosTime, 12); head.writeUInt16LE(dosDate, 14); head.writeUInt32LE(crc, 16); head.writeUInt32LE(packed.length, 20); head.writeUInt32LE(data.length, 24);
  head.writeUInt16LE(nameBuf.length, 28); head.writeUInt32LE(offset, 42);
  central.push(head, nameBuf);
  offset += 30 + nameBuf.length + packed.length;
}
const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([...parts, centralBuf, end]));
console.log(`${relative(process.cwd(), out)}: ${pkg.name} ${pkg.version}, ${files.length} arquivos, ${Math.round(statSync(out).size / 1024)} KB`);
