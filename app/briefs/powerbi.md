---
name: powerbi
title: Power BI (painel, dashboard, BI) a partir de planilhas
triggers: [power bi, powerbi, bi, dashboard, painel de indicadores, painel de vendas, painel financeiro, painel da operacao, indicadores, kpi, modelo semantico, dax, medida, tmdl, pbix, pbip]
avoid: [painel solar, painel do carro]
options: ["Mudar o estilo (claro, escuro ou a cor da marca)", "Juntar ou separar páginas", "Criar uma medida nova"]
---
Decida sozinho: a planilha (.xlsx/.csv) é a citada; senão, a do assunto (search_files UMA vez). Chame powerbi action=build com files e goal = o pedido nas palavras da pessoa. Não escolha páginas nem gráficos: a IA local planeja o BI.
Pergunte só se: não houver planilha do assunto: em uma linha, se manda a planilha ou se pode gerar dados fictícios. Fictícios ("é fictício", "pode inventar"): sample_data, uma chamada por tabela, centenas de linhas; depois action=build com esses arquivos.
Atualização: aberto, o painel se atualiza quando a planilha muda (no máximo a cada 10 min; diga isso). 3D/VR: action=vr.
Estrutura: as páginas e a pergunta de cada uma, os números dos cartões como vieram (R$ 94.419,80), e que o painel está aberto. Pergunta sobre o painel: action=query (gasto = Saídas, receita = Entradas, quantos = contagem; o item citado no filter, ex. Categoria=Marketing). "Mostra a doca parada": query, depois show com values e note. "E se tivéssemos mais caixas?": a tabela de simulação (diga que é simulação). Medida nova: action=change. Outro desenho: action=build de novo com o goal ajustado.
Confira antes de entregar: todo número veio da ferramenta; nunca descreva páginas ou gráficos que ela não criou; nunca invente dados.
