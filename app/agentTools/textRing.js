/**
 * Ring buffer of text: keeps the last `limit` characters of a stream and counts every character ever
 * written, so a reader that keeps its own position still finds what is new after the start was dropped.
 * Before it (14/10), command_output kept its place as `output.length`: once a dev server's output filled
 * the 60 000 characters, the length stopped growing and every later check said "(sem saída nova)".
 */
export function textRing(limit) {
  let kept = "";
  let total = 0;
  return {
    push(chunk) {
      const text = String(chunk ?? "");
      total += text.length;
      kept = text.length >= limit ? text.slice(-limit) : (kept + text).slice(-limit);
    },
    get text() { return kept; },
    /** Characters written since the start, dropped ones included: the position to read from next. */
    get total() { return total; },
    /** What came after position `pos`, and how much of it was already dropped from the ring. */
    since(pos) {
      const start = total - kept.length;
      return { text: kept.slice(Math.max(0, pos - start)), skipped: Math.max(0, start - pos) };
    },
  };
}
