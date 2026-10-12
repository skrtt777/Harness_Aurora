// The twin outside Power BI, for VR: a small server, started only when the person asks, that gives the
// open report's state (app/powerbiTwin.js: the same DAX as the scenes) and the 3D/WebXR page. Read only;
// the address carries a random code; HTTPS on the network (the Quest opens WebXR only on a secure page,
// certificate made in memory by app/selfsigned.js) and plain HTTP on this computer (localhost is secure).
import http from "node:http";
import https from "node:https";
import { networkInterfaces } from "node:os";
import { randomBytes } from "node:crypto";
import { selfSigned } from "./selfsigned.js";
import { serveXrFile } from "./xrStatic.js";

let running = null;
const lanAddresses = () => Object.values(networkInterfaces()).flat().filter((a) => a && a.family === "IPv4" && !a.internal).map((a) => a.address);

/**
 * Starts (once) the twin server. getState() -> the twin's JSON (or null when no report is open).
 * lan: also on the network (HTTPS), for the headset. Returns { local, network: [urls], token }.
 */
export async function startTwinServer({ getState, lan = true, port = 8765, securePort = 8766, everyMs = 15_000 } = {}) {
  if (running) return running.info;
  const token = randomBytes(9).toString("base64url");
  let cache = { at: 0, state: null };
  const handler = async (req, res) => {
    const url = new URL(req.url, "http://x");
    const [, tk, ...rest] = url.pathname.split("/");
    const what = rest.join("/");
    if (tk !== token || req.method !== "GET") { res.writeHead(404); return res.end(); }
    try {
      // The Aurora XR app (app/xr) in read-only mode: only the operation, from ./state next to it.
      if (what !== "state") { if (await serveXrFile(res, what)) return; res.writeHead(404); return res.end(); }
      if (what === "state") {
        // One read of the model every 15 s at most, however many are looking.
        if (Date.now() - cache.at > everyMs) cache = { at: Date.now(), state: (await getState()) || { version: 1, kind: "vazio", title: "Nenhum Power BI aberto pela Aurora", units: [], entities: [], numbers: {}, notes: [], highlight: { values: [], note: "" } } };
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        return res.end(JSON.stringify(cache.state));
      }
      res.writeHead(404); res.end();
    } catch (error) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: error.message })); }
  };
  const listen = (server, p, host) => new Promise((ok, fail) => { server.once("error", fail); server.listen(p, host, () => ok(server)); });
  const local = await listen(http.createServer(handler), port, "127.0.0.1").catch(() => listen(http.createServer(handler), 0, "127.0.0.1"));
  const ips = lan ? lanAddresses() : [];
  let secure = null;
  if (lan && ips.length) {
    const { key, cert } = selfSigned({ dns: ["localhost"], ips: ["127.0.0.1", ...ips] });
    secure = await listen(https.createServer({ key, cert }, handler), securePort, "0.0.0.0").catch(() => listen(https.createServer({ key, cert }, handler), 0, "0.0.0.0"));
  }
  const info = {
    token,
    local: `http://localhost:${local.address().port}/${token}/`,
    network: secure ? ips.map((ip) => `https://${ip}:${secure.address().port}/${token}/`) : [],
  };
  running = { servers: [local, secure].filter(Boolean), info };
  return info;
}

export function stopTwinServer() { for (const s of running?.servers || []) s.close(); running = null; }
export const twinServerInfo = () => running?.info || null;
