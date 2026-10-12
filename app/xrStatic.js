// The Aurora XR web app's files (app/xr): served by the XR bridge at /xr/app/ and by the twin server
// next to its state. Only files inside app/xr, only known types; no directory listing.
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("./xr/", import.meta.url)));
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png",
  ".glb": "model/gltf-binary", ".md": "text/markdown; charset=utf-8",
};
// Everything from this origin; three.js is vendored (app/xr/vendor), so it works on a network without internet.
// 'wasm-unsafe-eval': the meshopt decoder of the 3D models is WebAssembly (no eval of scripts).
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: data:; connect-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

/** Serves rel ("" = index.html) from app/xr. Returns false when there is no such file. */
export async function serveXrFile(res, rel) {
  const clean = decodeURIComponent(String(rel || "").split("?")[0]) || "index.html";
  const file = resolve(ROOT, clean);
  if (!file.startsWith(ROOT + sep) || !TYPES[extname(file)]) return false;
  let body;
  try { body = await readFile(file); } catch { return false; }
  res.writeHead(200, {
    "content-type": TYPES[extname(file)], "content-security-policy": CSP, "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer", "permissions-policy": "xr-spatial-tracking=(self), microphone=(self), camera=(self)",
    // The app changes with the Harness; the vendored library does not.
    // The models (assets/m) are named after their content's source and rebuilt rarely: cached a day.
    "cache-control": clean.startsWith("vendor/") || clean.startsWith("assets/m/") ? "public, max-age=86400" : "no-cache",
  });
  res.end(body);
  return true;
}
