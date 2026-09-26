---
name: browser-agent
description: Controlar um navegador Chromium real para abrir um endereço da internet, interagir com o que já está publicado nele, ou extrair o texto visível — quando o pedido depende de acessar algo que já existe na web, fora deste chat.
metadata:
  hermes:
    requires_tools: [browser_agent]
---
Use somente quando o pedido depende de um site real e não pode ser resolvido com o que já está no chat (ex.: "abra o site X e veja o preço", "preencha este formulário em Y", "veja o que aparece na página Z"). Não use para gerar HTML/JS por conta própria — isso é uma entrega normal, não navegação real.

O agente não vê imagem: ele lê a tela via OCR e decide clicar, digitar, navegar ou apertar tecla um passo de cada vez, sozinho, até terminar ou desistir. Pode levar minutos. Descreva a meta em uma frase clara e objetiva (o que fazer, não como). Uma única execução por etapa. O resultado (ações realizadas e conclusão) volta como referência para a próxima resposta — não invente o que a página mostrou além do que a execução relatou.
