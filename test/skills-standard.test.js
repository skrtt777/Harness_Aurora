import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "harness-skills-std-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
const home = join(temp, "home");
process.env.AURORA_SKILL_HOME = home;
const { allSkills, publishSkill, externalSkillRoots } = await import("../app/skills.js");

const skill = (name, body = "Faça assim.") => `---\nname: ${name}\ndescription: Uma skill de teste chamada ${name}.\n---\n\n${body}\n`;

test("skills of the other harnesses (Claude Code, Codex, OpenClaw, ~/.agents) are read in place", async () => {
  for (const [dir, name] of [[".claude", "do-claude"], [".openclaw/workspace", "do-openclaw"], [".agents", "do-padrao"]]) {
    mkdirSync(join(home, dir, "skills", name), { recursive: true });
    writeFileSync(join(home, dir, "skills", name, "SKILL.md"), skill(name));
  }
  const all = await allSkills();
  const by = (name) => all.find((s) => s.name === name);
  assert.equal(by("do-claude")?.source, "claude-local");
  assert.equal(by("do-openclaw")?.source, "openclaw-local");
  assert.equal(by("do-padrao")?.source, "agents-local");
  assert.equal(by("do-claude").enabled, false, "an outside skill is only used once a copy is imported");
  assert.ok(externalSkillRoots().every(([, root]) => root.startsWith(home)));
});

test("a skill is published as its SKILL.md to another harness' folder, never over a different one", async () => {
  const s = (await allSkills()).find((x) => x.name === "do-claude");
  const out = await publishSkill(s.id, "agents");
  assert.equal(readFileSync(out.path, "utf8"), s.text);
  assert.deepEqual(await publishSkill(s.id, "agents"), out, "publishing the same content again is fine");
  mkdirSync(join(home, ".codex", "skills", "do-claude"), { recursive: true });
  writeFileSync(join(home, ".codex", "skills", "do-claude", "SKILL.md"), skill("do-claude", "Outro texto."));
  await assert.rejects(publishSkill(s.id, "codex"), /Já existe outra skill/);
  await assert.rejects(publishSkill(s.id, "../../etc"), /Destino inválido/);
});
