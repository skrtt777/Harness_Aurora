// The Aurora's own know-how as memories: step-by-step guides the local model recalls like anything it has
// learned (they show in the Atlas, they come up in a related turn). The app writes them on start, once,
// and rewrites one only when its text here changed; a person may still edit or delete them.
import { createMemory, listMemories, updateMemory } from "./store.js";

export const GUIDES = [
  {
    id: "codigo-projeto",
    title: "Como criar um projeto de código (site, API, app, script) sem se perder",
    tags: ["guia", "codigo", "programacao", "site", "api", "projeto"],
    content: [
      "Vale para \"crie um site/uma API/um app/um script\" numa pasta de projeto (VS Code). Erros de 13/10: um site inteiro num arquivo só, cortado 4 vezes; arquivos fora da pasta pedida; testes que nunca rodaram; resposta \"deseja prosseguir?\" no lugar da entrega.",
      "1. Pasta: tudo dentro da pasta que a pessoa citou (\"na pasta api\" = api/...). Caminhos relativos à pasta do projeto (api/server.js, site/index.html), nunca Documentos.",
      "2. Planeje a estrutura antes (update_plan): a lista de arquivos, cada um com uma função. Arquivos pequenos: até umas 150 linhas cada (um componente, uma seção, um módulo, o CSS separado). O arquivo principal só junta os outros.",
      "3. Grave um arquivo por chamada de write_file. Se a ferramenta disser que foi cortado, divida esse arquivo em dois menores; nunca repita o mesmo arquivo grande.",
      "4. Tecnologias pedidas: cada uma de verdade. React e Three.js num site sem build: carregue pelo CDN (React UMD com Babel standalone, ou um importmap com three e three/addons) e diga isso. Java e C++ não rodam no navegador: um servidor Java (com.sun.net.httpserver, sem dependências) e um módulo C++ compilável (g++), cada um com um README de como rodar.",
      "5. Rode o que fez e corrija até funcionar (guia \"Como testar e corrigir código\"). Só depois responda.",
      "6. A resposta: o que foi feito, a árvore de arquivos com uma linha cada, como rodar (os comandos) e o que você conferiu rodando. Nada de \"deseja prosseguir?\" no meio do trabalho: termine o que foi pedido.",
    ].join("\n"),
  },
  {
    id: "codigo-testar",
    title: "Como testar e corrigir código (Node, Python, Java, C++, páginas)",
    tags: ["guia", "codigo", "teste", "erro", "node", "python", "powershell"],
    content: [
      "1. O terminal é o PowerShell do Windows: para dois comandos use ; (ou cd pasta; comando). A ferramenta já entende &&.",
      "2. Node: testes com const { test } = require(\"node:test\") e const assert = require(\"node:assert\"), rodando node --test pasta/. Não existe describe/it global sem importar. Servidor: exporte o servidor e só chame listen quando require.main === module; o teste sobe na porta 0 e fecha no fim.",
      "3. Python: open(caminho, encoding=\"utf-8\", newline=\"\"); ache arquivos pela pasta do script: Path(__file__).parent / \"jogos.csv\". Rode com python pasta/script.py.",
      "4. Java: javac -d out (arquivos .java) e java -cp out Classe. C++: g++ -std=c++17 -o programa arquivo.cpp. Se o compilador não existir, diga isso e como instalar; não finja que rodou.",
      "5. Página: abra com browser_navigate em file:///C:/pasta/index.html; a ferramenta devolve os erros do console. Erro de módulo/CORS em file://: use um importmap com CDN ou rode npx serve.",
      "6. Falhou: leia a mensagem de erro inteira, ache o arquivo e a linha, corrija com edit_file e rode de novo. Repita até passar. O mesmo erro duas vezes e você não sabe por quê: chame learn com o erro exato e a tecnologia.",
      "7. Na resposta, mostre a saída real do teste ou do script (ex.: \"5 testes passaram\"), nunca um resultado imaginado.",
    ].join("\n"),
  },
  {
    id: "aprender-sozinha",
    title: "Como aprender sozinha o que você não sabe",
    tags: ["guia", "aprender", "pesquisa", "documentacao", "erro"],
    content: [
      "Você não precisa saber tudo: precisa saber pesquisar. Antes de usar algo que você não domina (uma biblioteca, uma linguagem, um formato, um programa) ou quando um erro se repete:",
      "1. memory_search com o assunto: talvez você já aprendeu (as lições ficam como \"Aprendi: ...\").",
      "2. Não achou: chame learn com topic = a tecnologia + o objetivo ou o erro exato (ex.: \"node:test servidor http porta 0\", \"three.js importmap OrbitControls\", \"PowerShell Start-Process sem janela\"). Ela pesquisa a documentação oficial, lê, escreve a lição com exemplo e guarda na memória.",
      "3. Aplique a lição na hora e rode de novo para ver se resolveu.",
      "4. Aprendeu algo da pessoa ou do projeto (uma preferência, onde ficam os arquivos, um jeito certo de fazer): memory_save em uma frase.",
      "5. Nunca invente uma API, uma opção ou um resultado: se não achou na documentação, diga o que tentou.",
    ].join("\n"),
  },
  {
    id: "powerbi-montar",
    title: "Como montar um Power BI (passo a passo)",
    tags: ["guia", "power bi", "bi", "dashboard"],
    content: [
      "1. Ache os dados: a planilha (.xlsx) ou .csv do assunto (a que a pessoa citou; senão, procure nos Documentos e Downloads). Nunca invente dados — só quando a pessoa pedir dados de exemplo ou fictícios, e então siga o guia \"Como preparar as planilhas de um Power BI\".",
      "2. Chame a ferramenta powerbi com action=build, files com a planilha e goal com o pedido inteiro nas palavras da pessoa: o que quer ver, para quem é (diretoria, operação, dono do negócio) e o tom.",
      "3. Não escolha páginas nem gráficos: a ferramenta lê os dados (fluxo de etapas, dinheiro entrando e saindo, espaços com posição, itens por categoria) e a IA local planeja um BI único para o goal — páginas que respondem às perguntas do pedido, layout, cenas desenhadas pelos dados (pátio com docas e caminhões, torres por etapa, fluxo do dinheiro, planta 3D das salas, cidade dos itens) e estilo claro ou escuro.",
      "A cena é fiel aos dados: cada veículo é desenhado uma vez, onde está agora (o último registro em andamento dele) — 5 caminhões nas docas são 5 caminhões desenhados nas docas, 4 na estrada são 4 na estrada; os cartões contam com a mesma regra; o que não cabe no desenho aparece escrito (+N fora do desenho); com várias unidades (CD), o pátio mostra uma por vez e abre já numa delas.",
      "Gêmeo digital: quando os dados descrevem um lugar ou processo, a página principal pode ser a própria cena — viva (caminhões andando, selo AO VIVO), clicável (clicar numa doca, sala ou prédio filtra a página e acende o item) e com uma unidade por vez quando há várias (CD, filial).",
      "Em files vão os caminhos COMPLETOS das planilhas, como a ferramenta que as criou ou achou devolveu (ex.: C:\\Users\\...\\Documentos\\Departamentos.xlsx), e TODAS as planilhas do pedido.",
      "4. Confira antes de responder: o resultado traz \"Linhas por tabela\"; cada tabela dos dados precisa ter linhas. Se a ferramenta disser que uma tabela ficou sem linhas, NÃO diga que está pronto: leia a planilha com read_file, conserte com write_document no mesmo caminho e monte de novo.",
      "5. Responda com o que a ferramenta devolveu: onde estão as planilhas e o painel (caminhos completos), as páginas e a pergunta de cada uma, os números dos cartões exatamente como vieram, e que o painel está aberto no Power BI Desktop.",
      "Atualização: com o painel aberto, a Aurora o atualiza sozinha quando as planilhas mudam (confere a cada minuto) e pelo menos a cada 10 minutos; o selo AO VIVO mostra a hora e fica âmbar se passar de 10 minutos. Publicado no Power BI Service, o modo Importação tem poucas atualizações por dia: para no máximo 10 minutos lá, é preciso DirectQuery com atualização automática de página.",
      "6. Termine perguntando se está certo, com opções (mudar o estilo, juntar ou separar páginas, criar uma medida).",
    ].join("\n"),
  },
  {
    id: "powerbi-dados",
    title: "Como preparar as planilhas de um Power BI (sem painel vazio)",
    tags: ["guia", "power bi", "planilha", "excel", "dados de exemplo"],
    content: [
      "Vale quando a pessoa pede para CRIAR os dados (\"crie dados de uma empresa\", \"faça planilhas e monte um Power BI\"). Erros de 12/10 que deixaram três painéis vazios: planilha gravada a partir de um texto com títulos e listas, linhas escritas numa célula só, CSV com colunas a mais no cabeçalho, caminhos relativos, dados novos inventados quando a pessoa reclamou.",
      "0. Com 2 ou mais planilhas, divida com subagents: um subagente por planilha, a tarefa com as colunas, as regras do pedido (ex.: todos os departamentos acima de 300 funcionários, a coluna Departamento escrita igual nas três) e o caminho completo do arquivo. Quando voltarem, confira cada planilha com read_file e monte você o Power BI com todos os caminhos.",
      "1. Uma planilha .xlsx por assunto (Departamentos.xlsx, Funcionarios.xlsx, Frota.xlsx), cada uma com write_document. O content de uma planilha é SÓ a tabela: a primeira linha é o cabeçalho e cada linha seguinte é um registro, com as células separadas por | (ex.: \"Departamento | Funcionários | Gerente\\nVendas | 345 | Ana Lima\\nRH | 318 | Paulo Reis\"). Nada de títulos, listas, parágrafos ou linha \"Fonte:\" dentro de uma planilha.",
      "2. Todas as linhas com o mesmo número de colunas do cabeçalho, pelo menos 3 linhas de dados, nomes de coluna claros (sem Coluna1).",
      "3. Os números obedecem ao pedido em CADA linha (\"mais de 300 funcionários em cada departamento\" = toda linha da coluna Funcionários acima de 300, não o total da empresa). Valores como número (8500000 ou 8.500.000,00), datas dd/mm/aaaa, e uma coluna em comum entre as tabelas (ex.: Departamento) escrita igual em todas, para o painel relacionar.",
      "4. Muitos registros (centenas de funcionários): não copie centenas de linhas; a tabela de departamentos leva a contagem (coluna Funcionários) e a de funcionários uma amostra de 10 a 30 por departamento, dizendo que é amostra.",
      "5. Use os caminhos completos que o write_document devolveu (\"Criei C:\\...\\Frota.xlsx\") no powerbi build, com todas as planilhas. Não use a ferramenta excel para criar planilha (ela é só para trabalhar no Excel aberto, quando a pessoa pede) e não crie .docx ou .md a mais.",
      "6. Painel vazio ou números errados: conserte as planilhas que já existem (read_file para ver, write_document no mesmo caminho) e monte de novo. NUNCA invente outros dados nem troque por arquivos novos: os números da resposta são os das planilhas e os que a ferramenta devolveu.",
    ].join("\n"),
  },
  {
    id: "powerbi-perguntar",
    title: "Como responder perguntas sobre um Power BI aberto",
    tags: ["guia", "power bi", "dax", "medida"],
    content: [
      "1. Com o Power BI aberto, use powerbi action=query: measure (uma medida que existe, ex. Faturamento, Saídas no período, Em andamento) + by (a coluna, ex. Produto, Transportadora) + top + filter (ex. Ano=2026).",
      "2. Para \"qual X teve mais Y\": measure Y, by X, top 1. Para um total: só measure.",
      "Escolha a medida pelo sentido da pergunta: gastamos, gasto, despesa, pagamos → Saídas; recebemos, entrou, receita → Entradas ou Faturamento; quantos → a contagem (Qtd., Em andamento, no pátio); orçamento estourado → Execução do orçamento %. Um item citado (\"com marketing\", \"na loja Centro\") vai no filter (Categoria=Marketing), não numa lista de todos.",
      "3. Se a ferramenta disser que um valor de filtro não existe, use o valor ou a medida que ela indicar (ex.: atrasos são a medida [Entregas atrasadas], não Status=Atrasado).",
      "4. Responda com o número exatamente como veio (R$ 1.714.063,98, 86,2%), sem arredondar e sem inventar outros.",
      "5. \"Mostra\" / \"onde está\" / \"aponta\": primeiro consulte (action=query) para achar o nome exato; depois powerbi action=show com values (os nomes exatos: [\"Doca 03\"], [\"ABC-3P34\"], [\"Caixa 04\"], [\"MG\"]) e note (uma frase curta com o número da consulta). A cena acende um anel roxo e mostra a nota. Para apagar: show com values vazio.",
      "6. \"O que mudou?\": a cada atualização a Aurora escreve as notas na tabela 'Notas da Aurora' (consulte com dax EVALUATE 'Notas da Aurora') e avisa no Windows e no celular quando piora (mais atrasados, fila maior).",
      "7. \"E se…?\": o painel tem uma tabela de simulação (Cenário, Corte ou Variação). Responda com a linha do cenário pedido, dizendo que é simulação (ex.: measure \"Fila no cenário\", filter \"Cenário=+2 caixas\").",
      "8. \"Quero ver em 3D\" / \"no óculos\" / \"em VR\": powerbi action=vr abre o gêmeo digital no Aurora XR (endereço neste computador e, para o óculos Quest ou o celular, na rede): no óculos, \"Realidade mista\" põe a maquete na mesa de verdade (ou \"Entrar em VR\"); no celular, \"Ver na mesa (AR)\". O Aurora XR completo (conversa, memórias, projetos) fica em https://<ip do PC>:8788/xr/app/ com a ponte XR ligada (npm run xr). Diga os endereços exatamente como a ferramenta devolveu.",
      "9. Sob o título de cada página há uma frase da Aurora com o principal daquela página (feita dos números dela) e cada número tem um cartão com o último mês contra o anterior e a linha dos 12 meses: use esses números ao responder, consultando para confirmar.",
    ].join("\n"),
  },
  {
    id: "powerbi-ajustar",
    title: "Como ajustar um Power BI já feito",
    tags: ["guia", "power bi", "medida", "estilo"],
    content: [
      "1. Medida, coluna ou relação nova: powerbi action=change com ops (ex. {op:\"measure\", name:\"Lucro por pedido\", expression:\"DIVIDE([Lucro], [Qtd. de pedidos])\", format:\"\\\"R$\\\" #,0.00\"}); a ferramenta confere e desfaz se der erro.",
      "2. Outro desenho (só uma página, mais claro ou escuro, a cor da marca, para a diretoria, sem cena): powerbi action=build de novo com o mesmo arquivo e o goal ajustado com o que a pessoa pediu.",
      "3. Salvar: action=save. Dados novos na planilha: action=refresh.",
    ].join("\n"),
  },
];

const sourceOf = (id) => `aurora:guia:${id}`;

/** Writes the guides that are missing and rewrites the ones whose text changed here. */
export async function seedGuides(env = process.env) {
  const existing = new Map((await listMemories({ scope: "global", kind: "imported" })).filter((m) => String(m.source || "").startsWith("aurora:guia:")).map((m) => [m.source, m]));
  const done = [];
  for (const g of GUIDES) {
    const have = existing.get(sourceOf(g.id));
    if (!have) {
      await createMemory({ scope: "global", title: g.title, content: g.content, tags: g.tags, kind: "imported", source: sourceOf(g.id), env, dedupe: false });
      done.push(`+ ${g.id}`);
    } else if (have.content !== g.content || have.title !== g.title) {
      await updateMemory(have.id, { title: g.title, content: g.content, tags: g.tags }, env);
      done.push(`~ ${g.id}`);
    }
  }
  return done;
}
