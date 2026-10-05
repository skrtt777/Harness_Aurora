/**
 * The agent's browser and web_fetch must never reach Aurora's own services:
 * the harness UI/API is same-origin there (it would bootstrap a session and
 * could approve its own requests or widen its own permissions), and Ollama
 * or the XR bridge accept unauthenticated local calls. Any other loopback
 * address (a dev server on localhost:3000) stays reachable on purpose.
 */
const protectedPorts = new Set([8787, 8788, 11434, 18181]);

export function protectPort(port) {
  const value = Number(port);
  if (Number.isInteger(value) && value > 0) protectedPorts.add(value);
}

const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0|\[::\]|\[::ffff:127(?:\.\d{1,3}){3}\])$/i;

export function isProtectedUrl(input) {
  let url;
  try { url = new URL(String(input)); } catch { return false; }
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!LOOPBACK.test(host) && !host.endsWith(".localhost")) return false;
  const port = Number(url.port || (url.protocol === "https:" || url.protocol === "wss:" ? 443 : 80));
  return protectedPorts.has(port);
}

export function assertAllowedUrl(input) {
  if (isProtectedUrl(input)) throw new Error("Endereço interno da Aurora bloqueado para o agente.");
}
