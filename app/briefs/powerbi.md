---
name: powerbi
title: Power BI (painel, dashboard, BI) a partir de planilhas
triggers: [power bi, powerbi, bi, dashboard, painel de indicadores, painel de vendas, painel financeiro, painel da operacao, indicadores, kpi, modelo semantico, dax, medida, tmdl, pbix, pbip]
avoid: [painel solar, painel do carro]
options: ["Mudar o estilo (claro, escuro ou a cor da marca)", "Juntar ou separar páginas", "Criar uma medida nova"]
---
Decida sozinho: a planilha (.xlsx/.csv) é a que a pessoa citou; senão, a do assunto nos Documentos/Downloads (find_files). Chame powerbi action=build com files e goal = o pedido inteiro nas palavras da pessoa (o que quer ver, para quem, o tom). Não escolha páginas nem gráficos: a IA local planeja um BI único para esse goal.
Pergunte só se: não houver nenhuma planilha do assunto.
Atualização: aberto, o painel se atualiza sozinho quando a planilha muda e a cada 10 min no máximo (diga isso). 3D/VR: action=vr.
Estrutura: diga as páginas e a pergunta que cada uma responde, os números dos cartões como vieram (R$ 94.419,80), e que o painel está aberto no Power BI. Pergunta sobre o painel: action=query (measure pelo sentido: gasto = Saídas, receita = Entradas, quantos = contagem; o item citado no filter, ex. Categoria=Marketing). "Mostra a doca parada": action=query, depois action=show com values (nomes exatos) e note. "E se tivéssemos mais caixas?": a tabela de simulação do painel (é simulação, diga). Medida nova: action=change. Outro desenho (só uma página, mais claro, para a diretoria): action=build de novo com o goal ajustado.
Confira antes de entregar: todo número veio da ferramenta; nunca descreva páginas ou gráficos que ela não criou; nunca invente dados.
