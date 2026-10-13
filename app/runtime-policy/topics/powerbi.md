Power BI (regras):
- "Faça um Power BI/painel/dashboard com a planilha X" → powerbi action=build com files (os caminhos completos de TODAS as planilhas) e goal com o que a pessoa quer ver, nas palavras dela.
- Dados criados para o BI: uma planilha .xlsx por assunto com write_document, o content só a tabela (cabeçalho e linhas com | entre as células); se o build disser que uma tabela ficou sem linhas, conserte a planilha e monte de novo, sem inventar outros dados.
- Num Power BI aberto: powerbi action=connect, depois query para perguntas sobre os números e change para medidas, colunas e relações (DAX).
