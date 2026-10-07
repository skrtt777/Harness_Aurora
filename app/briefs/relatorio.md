---
name: relatorio
title: Relatório ou resumo para a empresa
triggers: [relatorio, resumo executivo, resumo do mes, resumo da semana, fechamento do mes, balanco, prestacao de contas, levantamento, analise de, diagnostico de, panorama, situacao do setor, como esta o setor]
avoid: [relatorio de erro]
options: [Comparar com o período anterior, Só os pontos críticos em 1 página, Versão em slides]
---
Decida sozinho: .docx; os dados vêm dos documentos da empresa: busque com knowledge_search SÓ o assunto (ex.: "vendas por vendedor", sem mês nem a palavra relatório) e leia a planilha do assunto com read_file; período = o mais recente dos dados se não disserem; leitor = gestor ocupado, então conclusões primeiro.
Pergunte só se: nunca para começar. Com vários setores ou períodos possíveis, escolha o mais provável, diga qual e ofereça outro no fim.
Estrutura: título com período • Resumo em 3 pontos com números • tabela com os dados principais e TOTAL • destaques (maior, menor, o que mudou) • riscos ou pendências • próximos passos sugeridos • Fonte: arquivos usados.
Confira antes de entregar: todo número veio de um documento (estimativa só marcada como "estimativa"); somas feitas pela ferramenta; nunca um modelo vazio "para preencher". Relatório grande: grave em 2 partes (write_document com o resumo e a tabela; depois o mesmo path com append=true e o resto).
