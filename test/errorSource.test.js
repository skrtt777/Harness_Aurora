import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { errorSource } = await import("../app/agentTools/system.js");

test("a failed script shows the code around the failing line (Python traceback, Node stack), not library frames", () => {
  const dir = mkdtempSync(join(tmpdir(), "aurora-err-"));
  writeFileSync(join(dir, "relatorio.py"), ["import csv", "dados = [1.5, 2.5]", "def f():", "    pass", "nomes = [str(d[0]) for d in dados]", "print(nomes)"].join("\n"));
  const py = `Traceback (most recent call last):\n  File "${join(dir, "relatorio.py")}", line 5, in <module>\n    nomes = [str(d[0]) for d in dados]\nTypeError: 'float' object is not subscriptable`;
  const shown = errorSource(py, dir);
  assert.match(shown, /Onde falhou \(.*relatorio\.py, linha 5\)/);
  assert.match(shown, />   5  nomes = \[str\(d\[0\]\) for d in dados\]/);
  assert.match(shown, /    2  dados = \[1\.5, 2\.5\]/);
  writeFileSync(join(dir, "app.js"), ["const a = 1;", "function soma(x) {", "  return x.y.z;", "}", "soma({});"].join("\n"));
  const node = `TypeError: Cannot read properties of undefined (reading 'z')\n    at soma (${join(dir, "app.js")}:3:14)\n    at Object.<anonymous> (${join(dir, "app.js")}:5:1)\n    at node:internal/modules/cjs/loader:1:1`;
  assert.match(errorSource(node, dir), /app\.js, linha 3\)[\s\S]*>   3    return x\.y\.z;/);
  // Relative paths (python relatorio.py run from the folder) and nothing for library-only stacks.
  assert.match(errorSource('  File "relatorio.py", line 5, in <module>', dir), /linha 5/);
  assert.equal(errorSource('  File "C:\\Python310\\lib\\python3.10\\csv.py", line 10', dir), "");
  assert.equal(errorSource("tudo certo", dir), "");
});
