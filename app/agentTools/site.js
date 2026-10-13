// create_site: the Aurora writes the content, app/siteBuilder.js writes a website that looks like one.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildSite, SITE_THEMES } from "../siteBuilder.js";
import { askedFolder, recordedWrite } from "./files.js";
import { checkPage, shotsFolder } from "../pageCheck.js";

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Where the site goes: the folder asked for, inside the project ("site" when none). */
function siteDir(folder, ctx) {
  const root = ctx.workspace || join(ctx.env?.USERPROFILE || process.env.USERPROFILE || ".", "Documents", "Aurora", "Sites");
  const name = String(folder || askedFolder(ctx.request) || "site").trim();
  const dir = isAbsolute(name) ? resolve(name) : resolve(root, name);
  if (ctx.workspace) { const inside = relative(resolve(ctx.workspace), dir); if (inside.startsWith("..") || isAbsolute(inside)) throw new Error("O site vai dentro da pasta do projeto: use um caminho relativo (ex.: site)."); }
  return dir;
}

export const siteTools = [
  {
    name: "create_site",
    description: "Cria um WEBSITE completo e bonito numa pasta: menu responsivo, topo com cena 3D (Three.js), cartões em React com filtro, busca e detalhes, ranking, seções e contato; com java=true um servidor Java, com cpp=true um módulo C++. Você só escreve o conteúdo (título, frase, itens com nome, categoria, detalhe, nota e descrição) e escolhe o tema. Use SEMPRE que pedirem um site, página ou portal, em vez de escrever HTML à mão.",
    parameters: {
      type: "object",
      properties: {
        folder: { type: "string", description: "pasta do site dentro do projeto (ex.: site)" },
        title: { type: "string", description: "nome do site" },
        tagline: { type: "string", description: "frase de 1 linha do topo" },
        theme: { type: "string", enum: Object.keys(SITE_THEMES), description: Object.entries(SITE_THEMES).map(([k, t]) => `${k}: ${t.label}`).join("; ") },
        itemsTitle: { type: "string", description: "nome da lista principal (Jogos, Produtos, Receitas…)" },
        items: { type: "array", description: "8 a 16 itens reais do assunto", items: { type: "object", properties: { name: { type: "string" }, category: { type: "string" }, detail: { type: "string", description: "ex.: o ano, o preço" }, score: { type: "number", description: "0 a 10" }, description: { type: "string", description: "1 ou 2 frases" } }, required: ["name", "category", "description"] } },
        features: { type: "array", description: "3 recursos ou diferenciais", items: { type: "object", properties: { title: { type: "string" }, text: { type: "string" } }, required: ["title", "text"] } },
        about: { type: "string", description: "2 a 4 frases sobre o site" },
        java: { type: "boolean" }, cpp: { type: "boolean" }, three: { type: "boolean" },
      },
      required: ["title", "tagline", "items"],
    },
    stage: (a) => `Criando o site ${a.title || ""}…`,
    describe: (a, ctx) => ({ kind: "write", paths: [siteDir(a.folder, ctx)], summary: `Criar o site ${a.title || ""} em ${siteDir(a.folder, ctx)}` }),
    async run(args, ctx) {
      const asked = fold(ctx.request);
      const dir = siteDir(args.folder, ctx);
      // The technologies the person named are in, whatever the model sent.
      const input = { ...args, java: args.java || /\bjava(?!script)\b/.test(asked), cpp: args.cpp || /c\+\+|\bcpp\b/.test(asked), three: args.three !== false || /three/.test(asked) };
      const { files, content } = await buildSite(dir, input, { write: (file, text) => recordedWrite(file, Buffer.from(text, "utf8"), ctx) });
      // The Java server compiled already ("java -cp server/out Servidor" found no class, 13/10).
      let compiled = null;
      if (content.java) compiled = await new Promise((done) => execFile("javac", ["server/Servidor.java", "-d", "server/out"], { cwd: dir, windowsHide: true, timeout: 60000 }, (error, _out, err) => done(error ? `não compilou (${String(err || error.message).split(/\r?\n/)[0].slice(0, 120)})` : "compilado")));
      const index = join(dir, "index.html");
      // Looked at like a person would, at a computer's and a phone's size.
      ctx.onStage?.("Conferindo o site no computador e no celular…");
      const check = await checkPage(pathToFileURL(index).href, { shotsDir: shotsFolder(pathToFileURL(index).href), env: ctx.env }).catch((e) => ({ report: `Não consegui conferir: ${e.message}` }));
      return [
        `Criei o site "${content.title}" em ${dir} (tema ${content.theme}, ${content.items.length} itens):`,
        `O que ele tem (descreva só isto): menu fixo com as seções ${["Início", content.itemsTitle, ...(content.features.length ? ["Recursos"] : []), "Sobre", "Contato"].join(", ")}, que vira um menu ☰ no celular e acende a seção na tela;${content.three ? " no topo, uma cena 3D em Three.js com formas geométricas flutuando nas cores do tema, que segue o mouse;" : ""} os ${content.items.length} ${content.itemsTitle.toLowerCase()} em cartões React com filtro por categoria (${[...new Set(content.items.map((i) => i.category))].join(", ")}), busca, ordenação e um painel de detalhes ao clicar; ranking dos 5 de maior nota; formulário de contato.`,
        ...files.map((f) => `- ${f}`),
        `Para ver: dois cliques em ${index} (ou browser_navigate em ${pathToFileURL(index).href}).`,
        ...(content.java ? [compiled === "compilado" ? "Java: já compilado; para rodar, na pasta do site: java -cp server/out Servidor (http://localhost:8080)." : `Java: ${compiled} — na pasta do site: javac server/Servidor.java -d server/out e depois java -cp server/out Servidor (http://localhost:8080).`] : []),
        ...(content.cpp ? ["C++: g++ -std=c++17 -O2 -o ranking cpp/ranking.cpp e ./ranking."] : []),
        `Conferência: ${check.report}`,
        "Para mudar o conteúdo, chame create_site de novo com a mesma pasta. Na resposta, diga o que tem o site, o resultado da conferência e como abrir.",
      ].join("\n");
    },
  },
];
export const siteExists = (dir) => existsSync(join(dir, "index.html"));
