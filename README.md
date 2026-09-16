# AI Harness — Memory Atlas

Experiência local para testar um harness de IA com histórico de conversas e um atlas de memórias em WebGL 3D. O histórico é salvo automaticamente no navegador, no mesmo padrão de continuidade esperado em uma conversa do ChatGPT.

## Rodar localmente

Requisitos: Node.js 20+ e Codex CLI instalado e autenticado no terminal.

Em um terminal, inicie a API:

```powershell
npm install
npm start
```

Em outro terminal, inicie a interface:

```powershell
npm run frontend:dev
```

Abra `http://127.0.0.1:5173`. O Vite encaminha `/api` para `http://127.0.0.1:8787`.

No Windows, `start-test.cmd` abre a API, a interface e o navegador automaticamente.

## Instalação Windows

Execute `installer\install.cmd`. O instalador não exige administrador, copia o app para `%LOCALAPPDATA%\AI-Harness`, instala as dependências, valida o build e cria um atalho na área de trabalho. Node.js 20+ e Codex CLI autenticado são pré-requisitos.

Para remover a aplicação, execute `installer\Uninstall-AIHarness.ps1`. O histórico salvo no navegador não é apagado.

## Histórico de mensagens

As conversas aparecem na barra lateral e podem ser reabertas a qualquer momento. Mensagens, título da conversa, provedor e memórias acessadas são persistidos em `localStorage` com limite de 100 conversas por navegador. O armazenamento é local: cada tester terá seu próprio histórico e não há sincronização entre computadores nesta versão.

## Distribuir para testers

Entregue a pasta do projeto ou um pacote versionado e peça ao tester para executar os dois comandos acima. O modo atual é explicitamente local/demonstrativo e não declara sincronização online.

Para atualizar uma cópia que esteja em um checkout Git:

```powershell
.\update.cmd
```

O atualizador faz `git pull`, instala dependências do frontend e executa o build. Ele não remove `app/data/` nem o histórico salvo no navegador. Se a cópia não tiver `.git`, distribua a nova pasta/pacote e execute o mesmo comando para validar a instalação.

## Validação rápida

```powershell
npm test
npm run check
npm run frontend:build
```

Na interface, valide: criação e reabertura de conversas, pesquisa/filtros, rotação/zoom/pan, seleção de neurônio, modo CAD, wireframe, ortográfico, inspeção e fallback para lista quando WebGL não estiver disponível.

## Dados

Na ausência de dados reais, a aplicação carrega 1.000 registros sintéticos claramente marcados como demonstração. Use “Importar JSON” para carregar dados reais; o formato aceito está em `frontend/src/data.ts`.
