// The lines Ctrl+I sends, widened to whole blocks: a selection that opens a "{" (or a Python "def:")
// without closing it would make the model rewrite half a function and the file come back broken (the
// usage scenarios, 27/10: the closing "}" was left after the model's own). Plain Node, tested.
"use strict";

/** Brackets of a line outside strings and line comments: +1 per opener, -1 per closer. */
function balanceOf(line) {
  let depth = 0, quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) { if (c === "\\") i += 1; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "/" && line[i + 1] === "/") break;
    if ("{([".includes(c)) depth += 1;
    else if ("})]".includes(c)) depth -= 1;
  }
  return depth;
}
const indentOf = (line) => /^[ \t]*/.exec(line)[0].replace(/\t/g, "    ").length;

/**
 * [start, end) widened so the brackets inside balance (C-like languages), or so a Python block opened by
 * the first line ends inside (indentation). At most `max` lines more; otherwise as it was.
 */
function widenToBlock(lines, start, end, { language = "", max = 120 } = {}) {
  let s = start, e = end;
  if (/python/i.test(language)) {
    // A line ending with ":" opens a block: everything more indented after it goes too.
    const opener = lines.slice(s, e).findIndex((l) => /:\s*(#.*)?$/.test(l) && l.trim());
    if (opener >= 0) {
      const base = indentOf(lines[s + opener]);
      let k = e;
      while (k < lines.length && k - end < max && (!lines[k].trim() || indentOf(lines[k]) > base)) k += 1;
      while (k > e && !lines[k - 1].trim()) k -= 1;
      e = Math.max(e, k);
    }
    return [s, e];
  }
  let depth = 0;
  for (let i = s; i < e; i += 1) depth += balanceOf(lines[i]);
  while (depth > 0 && e < lines.length && e - end < max) { depth += balanceOf(lines[e]); e += 1; }
  if (depth > 0) return [start, end];
  // Closers without their openers: the opening lines above come too.
  let low = 0, run = 0;
  for (let i = s; i < e; i += 1) { run += balanceOf(lines[i]); low = Math.min(low, run); }
  let need = -low;
  while (need > 0 && s > 0 && start - s < max) { s -= 1; need -= balanceOf(lines[s]); }
  if (need > 0) return [start, end];
  return [s, e];
}

module.exports = { widenToBlock, balanceOf };
