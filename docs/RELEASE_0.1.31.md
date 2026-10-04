# Aurora 0.1.31: onde estão os seus arquivos (uso pessoal e empresa)

## Escolha como você usa a Aurora

Uma etapa nova nos primeiros passos, **"Seus arquivos"**, e o topo de **Configurações → Conhecimento** perguntam como você vai usar a Aurora: **Uso pessoal**, **Empresa** ou **Os dois**.

## Uso pessoal

- **Acesso a todo o computador:** a Aurora lê e procura arquivos em qualquer disco sem você apontar pastas.
  - **Continuam pedindo autorização:** senhas e chaves (`.ssh`, `.kdbx`, `.pem`, `.env`), perfis de navegador e as pastas do Windows. Alterar, apagar ou rodar comandos fora da pasta do projeto também continua pedindo, como no modo Auto.
  - **Vem desligado:** cada pessoa liga quando quiser.
- **Lembrar pelo assunto:** indexa Documentos, Área de Trabalho e Downloads para achar arquivos pelo que eles dizem ("aquele contrato do aluguel"), não só pelo nome. Tudo fica neste computador.

## Empresa

- **Descoberta automática:**
  - **Onde procura:** na pasta que você indicar (`\servidor\dados`, `F:\Empresa`) ou, sem pasta, nas unidades de rede e nas bibliotecas do SharePoint sincronizadas pelo OneDrive.
  - **Setor pelo nome da pasta:** "RH", "02 - Recursos Humanos", "SESMT", "Tributário", em 16 setores e suas variações.
  - **Confirmação:** você confere o setor de cada pasta, desmarca o que não é da empresa e cadastra tudo de uma vez. Nada é lido antes disso.
- **Pelo chat:** "minhas pastas da empresa ficam em F:\Empresa, configure para mim". A Aurora mostra a lista e só cadastra depois que você aprovar.
- **Manual:** pasta e setor, como antes.

## Verificação

- `npm test`: 396 testes passaram, 0 falhas. Isso inclui a etapa nova do guia num navegador real e a regra de que o acesso total nunca liga sozinho.
- **Descoberta:** numa empresa de teste, ela achou os 15 setores pelo nome das pastas.
