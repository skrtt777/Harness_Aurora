// Line diff for the review inside the editor (Ctrl+I and "Revisar no editor"): the old text and the
// new one as hunks, each one a block of removed lines followed by the lines that replace them. Plain
// Node, no VS Code: the same lines and hunks are tested in test/vscode-aurora.test.js.
"use strict";

const MAX_CELLS = 4_000_000;   // beyond this (≈2000 × 2000 changed lines) the middle is one hunk

/**
 * Hunks between two lists of lines: [{ at, removed: [..], added: [..] }], where `at` is the index of
 * the first removed line in `a` (or where the added lines go). Unchanged lines are not in any hunk.
 */
function diffLines(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA -= 1; endB -= 1; }
  const midA = a.slice(start, endA), midB = b.slice(start, endB);
  if (!midA.length && !midB.length) return [];
  if (!midA.length || !midB.length || midA.length * midB.length > MAX_CELLS) return [{ at: start, removed: midA, added: midB }];
  // Longest common subsequence, from the end (so walking forward is greedy and simple).
  const n = midA.length, m = midB.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const hunks = [];
  let i = 0, j = 0, open = null;
  const close = () => { if (open) { hunks.push(open); open = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && midA[i] === midB[j]) { close(); i += 1; j += 1; continue; }
    if (!open) open = { at: start + i, removed: [], added: [] };
    if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) { open.added.push(midB[j]); j += 1; }
    else { open.removed.push(midA[i]); i += 1; }
  }
  close();
  // A line that is only blank between two hunks joins them (one decision instead of two).
  const merged = [];
  for (const h of hunks) {
    const last = merged.at(-1);
    if (last && h.at - (last.at + last.removed.length) <= 1 && a.slice(last.at + last.removed.length, h.at).every((l) => !l.trim())) {
      const gap = a.slice(last.at + last.removed.length, h.at);
      last.removed.push(...gap, ...h.removed); last.added.push(...gap, ...h.added);
    } else merged.push({ ...h, removed: [...h.removed], added: [...h.added] });
  }
  return merged;
}

/** The text with every hunk applied, or only the accepted ones (decide(hunk, index) -> boolean). */
function applyHunks(a, hunks, decide = () => true) {
  const out = [];
  let i = 0;
  hunks.forEach((h, k) => {
    while (i < h.at) out.push(a[i++]);
    if (decide(h, k)) out.push(...h.added); else out.push(...h.removed);
    i += h.removed.length;
  });
  while (i < a.length) out.push(a[i++]);
  return out;
}

/** How a change is counted on screen: "+3 −1". */
const countText = (hunks) => {
  const plus = hunks.reduce((s, h) => s + h.added.length, 0), minus = hunks.reduce((s, h) => s + h.removed.length, 0);
  return `+${plus} −${minus}`;
};

module.exports = { diffLines, applyHunks, countText };
