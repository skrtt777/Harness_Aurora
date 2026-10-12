// The Aurora's own know-how as memories: step-by-step guides the local model recalls like anything it has
// learned (they show in the Atlas, they come up in a related turn). The app writes them on start, once,
// and rewrites one only when its text here changed; a person may still edit or delete them.
import { createMemory, listMemories, updateMemory } from "./store.js";

export const GUIDES = [
  {
    id: "powerbi-montar",
    title: "Como montar um Power BI (passo a passo)",
    tags: ["guia", "power bi", "bi", "dashboard"],
    content: [
      "1. Ache os dados: a planilha (.xlsx) ou .csv do assunto (a que a pessoa citou; senão, procure nos Documentos e Downloads). Nunca invente dados.",
      "2. Chame a ferramenta powerbi com action=build, files com a planilha e goal com o pedido inteiro nas palavras da pessoa: o que quer ver, para quem é (diretoria, operação, dono do negócio) e o tom.",
      "3. Não escolha páginas nem gráficos: a ferramenta lê os dados (fluxo de etapas, dinheiro entrando e saindo, espaços com posição, itens por categoria) e a IA local planeja um BI único para o goal — páginas que respondem às perguntas do pedido, layout, cenas desenhadas pelos dados (pátio com docas e caminhões, torres por etapa, fluxo do dinheiro, planta 3D das salas, cidade dos itens) e estilo claro ou escuro.",
      "A cena é fiel aos dados: cada veículo é desenhado uma vez, onde está agora (o último registro em andamento dele) — 5 caminhões nas docas são 5 caminhões desenhados nas docas, 4 na estrada são 4 na estrada; os cartões contam com a mesma regra; o que não cabe no desenho aparece escrito (+N fora do desenho); com várias unidades (CD), o pátio mostra uma por vez e abre já numa delas.",
      "Gêmeo digital: quando os dados descrevem um lugar ou processo, a página principal pode ser a própria cena — viva (caminhões andando, selo AO VIVO), clicável (clicar numa doca, sala ou prédio filtra a página e acende o item) e com uma unidade por vez quando há várias (CD, filial).",
      "4. Responda com o que a ferramenta devolveu: as páginas e a pergunta de cada uma, os números dos cartões exatamente como vieram, e que o painel está aberto no Power BI Desktop.",
      "Atualização: com o painel aberto, a Aurora o atualiza sozinha quando as planilhas mudam (confere a cada minuto) e pelo menos a cada 10 minutos; o selo AO VIVO mostra a hora e fica âmbar se passar de 10 minutos. Publicado no Power BI Service, o modo Importação tem poucas atualizações por dia: para no máximo 10 minutos lá, é preciso DirectQuery com atualização automática de página.",
      "5. Termine perguntando se está certo, com opções (mudar o estilo, juntar ou separar páginas, criar uma medida).",
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
      "8. \"Quero ver em 3D\" / \"no óculos\" / \"em VR\": powerbi action=vr abre o gêmeo digital (endereço neste computador e, para o Quest, na rede); no app Aurora do Quest a página Operação mostra a mesma operação como maquete na mesa. Diga os endereços exatamente como a ferramenta devolveu.",
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
