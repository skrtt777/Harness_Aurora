import test from "node:test";
import assert from "node:assert/strict";
import { webTools } from "../app/agentTools/web.js";

test("web_fetch with a file of the computer says to use read_file", async () => {
  const fetchTool = webTools.find((t) => t.name === "web_fetch");
  await assert.rejects(fetchTool.run({ url: "F:\\EmpresaIA\\Comercial\\Tabela.pdf" }, {}), /arquivo do computador[\s\S]*read_file/);
  await assert.rejects(fetchTool.run({ url: "file:///C:/x.pdf" }, {}), /read_file/);
});
