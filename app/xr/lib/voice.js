// Voice: short commands said to the Aurora (whole phrases, so a quoted word in a normal request does
// not cancel a turn), and the microphone's audio as 16-bit WAV for the PC's transcription.

const normalize = (text) => String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[.,!?:;]/g, " ").split(/\s+/).filter(Boolean).join(" ");

const COMMANDS = [
  ["stop", ["pare", "parar", "parar conversa", "pare de falar", "cancelar resposta", "cancele a resposta", "silencio"]],
  ["repeat", ["repita", "repetir resposta", "repita a resposta"]],
  ["help", ["ajuda", "como usar", "comandos de voz"]],
  ["page:operacao", ["mostra a operacao", "mostre a operacao", "operacao", "power bi", "abre o power bi", "mostra o power bi", "maquete", "mostra a maquete"]],
  ["page:conversa", ["conversa", "volta pra conversa", "volta para a conversa"]],
  ["page:cenarios", ["cenarios", "mostra os cenarios", "meus cenarios", "maquetes"]],
  ["scene:next", ["proximo cenario", "outro cenario", "troca o cenario"]],
  ["page:memorias", ["memorias", "mostra as memorias", "minhas memorias"]],
  ["page:projetos", ["projetos", "mostra os projetos", "trocar projeto"]],
  ["recenter", ["recentralizar", "recentraliza", "traz o painel", "vem aqui", "painel aqui", "centralizar"]],
  ["place", ["colocar na mesa", "coloca na mesa", "poe na mesa", "posicionar maquete"]],
  ["refresh", ["atualizar", "atualiza", "atualize"]],
];

/** "Aurora, pare." -> "stop"; a normal request -> null. */
export function voiceCommand(text) {
  let t = normalize(text);
  t = t.replace(/^(oi |ola |ei |hey )?aurora /, "");
  for (const [name, phrases] of COMMANDS) if (phrases.includes(t)) return name;
  return null;
}

export const VOICE_HELP = "Diga: \"faz uma fazenda com vacas\" (a Aurora monta a maquete), \"adiciona 3 cavalos\", \"mostra a operação\", \"conversa\", \"memórias\", \"traz o painel\", \"coloca na mesa\", \"atualizar\", \"repita\" ou \"pare\". Qualquer outra frase vai para a Aurora.";

/** Mono float samples -> 16 kHz (the transcriber's rate), by averaging. */
export function downsample(samples, from, to = 16000) {
  if (from === to) return Float32Array.from(samples);
  const ratio = from / to; const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio); const b = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let s = 0; for (let j = a; j < b; j++) s += samples[j];
    out[i] = s / Math.max(1, b - a);
  }
  return out;
}

/** Float samples (-1..1) -> a 16-bit PCM mono WAV file. */
export function encodeWav(samples, rate = 16000) {
  const bytes = new Uint8Array(44 + samples.length * 2); const v = new DataView(bytes.buffer);
  const text = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
  text(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); text(8, "WAVE");
  text(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  text(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return bytes;
}

/** Bytes -> base64 (browser and Node). */
export function toBase64(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Speech ends after this much quiet once something was said (or a hard limit). */
export class SilenceGate {
  constructor({ threshold = 0.02, quiet = 1.1, limit = 20 } = {}) { Object.assign(this, { threshold, quiet, limit }); this.heard = false; this.silence = 0; this.age = 0; }
  update(level, dt) {
    this.age += dt;
    if (level > this.threshold) { this.heard = true; this.silence = 0; } else this.silence += dt;
    return (this.heard && this.silence > this.quiet) || this.age > this.limit || (!this.heard && this.age > 6);
  }
}

/**
 * What is said aloud of a reply: its opening, without code, tables or markdown, up to two sentences
 * (about 240 characters), so the voice is quick to make on the PC and short to hear.
 */
export function spokenPart(text, max = 240) {
  let s = String(text || "").replace(/```[\s\S]*?(```|$)/g, " ").replace(/^\s*\|.*$/gm, " ").replace(/[*_#>`]+/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const sentences = s.match(/[^.!?]+[.!?]+/g) || [];
  let out = ""; for (const x of sentences) { if ((out + x).length > max) break; out += x; }
  if (!out) out = s.slice(0, max).replace(/\s+\S*$/, "") + "…";
  return out.trim();
}
