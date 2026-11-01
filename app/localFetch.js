import { Agent } from "undici";

// fetch for the local model (llama-server, Ollama). Node's fetch gives up when the first byte takes
// more than 5 minutes (undici headersTimeout), and a notebook CPU reading a long prompt — a Power BI
// model and its tool results — takes longer: the turn failed as a bare "fetch failed" (empresa,
// 30/10/2026). Here the request's own signal is the limit (LOCAL_TIMEOUT_MS, 15 min on CPU).
const patient = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

export const localFetch = (url, init = {}) => fetch(url, { ...init, dispatcher: patient });

/** "fetch failed" and bare "terminated" (undici's own wording when the connection cuts mid-response,
 * e.g. llama-server crashing under memory pressure, 01/11/2026) say nothing on their own: the reason
 * under them (ECONNRESET, UND_ERR_SOCKET…) goes with it. */
export function fetchErrorText(error) {
  const message = String(error?.message || error || "");
  const cause = error?.cause;
  if (!/fetch failed|^terminated$/i.test(message) || !cause) return message;
  return `${message} (${[cause.code, cause.message].filter(Boolean).join(": ")})`;
}
