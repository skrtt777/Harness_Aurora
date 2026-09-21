# Harness Aurora 0.1.17

Esta versão reúne as mudanças locais posteriores à 0.1.13 em um instalador Windows x64.

## O que mudou

- Interface Aurora com layout mais amplo, identidade visual, animação durante a resposta e visualização de arquivos ao lado da conversa.
- Correção da largura do Atlas 3D e da tela de testes.
- Regras internas, seleção de contexto por relevância e orçamento, execução por etapas e retomada de tarefas.
- Validação de artefatos HTML, contratos funcionais, diagnóstico e tentativas limitadas de correção.
- Engine de Evidências: procedimentos aprendidos a partir de reparos testados, com revisão e escopo por conversa/projeto.
- Catálogo de skills, importação para revisão, checagem de requisitos e ativação sob demanda. O catálogo não equivale a ferramentas instaladas ou compatibilidade garantida.
- Métricas de uso, tokens medidos/estimados separados e simulação editável de energia.
- Seleção automática do modelo local com verificação de aprovação e integridade de modelos experimentais.

## Instalação e atualização

Baixe `Harness-Aurora-Setup-0.1.17.exe` na release e execute o instalador. Usuários com versões anteriores podem usar a atualização integrada ou instalar sobre a versão existente. Conversas e memórias permanecem em `%APPDATA%\Harness Aurora\`.

O instalador ainda não possui assinatura digital de editor; o Windows pode exibir um aviso ao executá-lo. Confira a origem nesta release e o arquivo de hashes publicado junto ao instalador.

Para usar o provedor Local, siga a configuração inicial do Ollama e o download do modelo. Para os provedores Codex/Claude, autentique o CLI correspondente. O navegador de automação tem download próprio quando essa funcionalidade é configurada.

A release inclui o instalador, seu blockmap, `latest.yml` para atualização automática e `SHA256SUMS.txt` para conferência dos arquivos. Pesos de modelos são baixados separadamente.

## Limites conhecidos

- A validação automática atual cobre artefatos HTML autocontidos e contratos suportados; não representa execução de qualquer projeto ou garantia de precisão geral.
- Os treinamentos Aurora v1/v2 continuam experimentais. A v2 empatou em 2/24 aprovações com a base equivalente e apresentou regressão de retenção. Nenhum desses pesos substitui o modelo padrão nesta distribuição.
- Energia usa hipóteses editáveis de R$ 1,00/kWh e 300 W; não é medição elétrica.
- A instalação não leva bancos pessoais, credenciais, skills importadas, ambientes Python, pesos de treinamento ou logs locais. A coleção autoral de jogos está disponível no código-fonte para importação.
- Documentos de pesquisa descrevem experimentos locais. Diretórios `reports/` (exceto o resumo agregado da engine), `output/` e `models/local-training/` são gerados durante os experimentos e não acompanham o código-fonte.

## Desenvolvimento

Validação local desta distribuição: 236 testes do aplicativo e 6 testes da memória visual aprovados, sem falhas ou testes ignorados; build de produção concluído; teste do aplicativo empacotado aprovado, incluindo persistência após reinício. Manifesto de atualização conferido contra tamanho e SHA-512 do instalador.

```powershell
npm ci
npm --prefix frontend ci
npx playwright install chromium
npm run check
npm run frontend:build
npm test
npm run test:memory
npm run dist
node scripts/smoke-electron.mjs "release/win-unpacked/Harness Aurora.exe"
```

O teste desktop usa um diretório temporário e confere inicialização, persistência após reinício, OCR e integração de processos no aplicativo empacotado.
