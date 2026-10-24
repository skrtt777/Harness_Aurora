// Brazilian boleto "linha digitável" → value and due date: printed bills put "Valor" and "Vencimento" in any
// layout, but the digit line always carries both (read by app/agentTools/bills.js).
// Bank boletos (47 digits): AAABC.CCCCX DDDDD.DDDDDY EEEEE.EEEEEZ K FFFFVVVVVVVVVV — FFFF the due-date
// factor (days from 07/10/1997; since 22/02/2025 it restarted at 1000), V the value in cents.
// Utility/tax ones (48 digits, starting with 8): the value in digits 5-15 when the 3rd digit is 6 or 8.

const DAY = 86_400_000;
const OLD_BASE = Date.UTC(1997, 9, 7);
const NEW_BASE = Date.UTC(2025, 1, 22); // factor 1000 again

/** Every linha digitável (or barcode) in a text, digits only. */
export function digitLines(text) {
  const out = [];
  for (const m of String(text || "").matchAll(/(?:\d[\d.\s-]{40,60}\d)/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length === 47 || digits.length === 48 || digits.length === 44) out.push(digits);
  }
  return out;
}

/** The due date of a factor: of the two bases, the one closest to now (the factor wrapped in 2025). */
export function factorDate(factor, now = Date.now()) {
  if (!factor) return null;
  const candidates = [OLD_BASE + factor * DAY, NEW_BASE + (factor - 1000) * DAY].filter((t) => t > Date.UTC(2000, 0, 1));
  const best = candidates.sort((a, b) => Math.abs(a - now) - Math.abs(b - now))[0];
  const d = new Date(best);
  return { day: d.getUTCDate(), month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
}

/** { value, due } from one boleto line, or null. */
export function decodeBoleto(digits, now = Date.now()) {
  const d = String(digits).replace(/\D/g, "");
  if (d.length === 47) {
    const factor = Number(d.slice(33, 37)), cents = Number(d.slice(37, 47));
    return { value: cents / 100, due: factorDate(factor, now), kind: "bancário" };
  }
  if (d.length === 44 && d[0] !== "8") {
    const factor = Number(d.slice(5, 9)), cents = Number(d.slice(9, 19));
    return { value: cents / 100, due: factorDate(factor, now), kind: "bancário" };
  }
  if ((d.length === 48 || d.length === 44) && d[0] === "8") {
    // 48: four blocks of 11 + check digit; the barcode is the blocks without their check digits.
    const bar = d.length === 48 ? [0, 12, 24, 36].map((i) => d.slice(i, i + 11)).join("") : d;
    if (!/[68]/.test(bar[2])) return null; // reference value, not the amount
    return { value: Number(bar.slice(4, 15)) / 100, due: null, kind: "arrecadação" };
  }
  return null;
}
