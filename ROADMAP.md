# Roadmap de Execução — AI Harness

## 1. Visão do produto

Aplicativo local para trabalhar com agentes de IA de forma individual ou colaborativa.

O uso individual será o padrão: o usuário pode trabalhar somente com o Codex. Outros provedores, como Claude, Gemini e Ollama, serão integrações opcionais.

## 2. Objetivo do MVP

Entregar uma aplicação instalável localmente que permita:

- Configurar um ou mais provedores de IA.
- Usar um único provedor por tarefa.
- Comparar respostas de vários provedores.
- Criar um fluxo simples de colaboração entre agentes.
- Salvar histórico localmente.
- Instalar, iniciar, resetar e atualizar o sistema com poucos cliques.

## 3. Stack inicial proposta

- **Frontend:** React + TypeScript.
- **Backend local:** Node.js + TypeScript.
- **API:** Fastify ou Express.
- **Banco:** SQLite.
- **Integrações:** adaptadores com interface comum.
- **Instalação e atualização inicial:** Pinokio.
- **Empacotamento desktop posterior:** Tauri.

## 4. Fases de execução

### Fase 0 — Fundação

**Objetivo:** preparar o projeto e validar as decisões técnicas.

- Criar o repositório e a estrutura `app/`.
- Definir padrões de configuração, logs e variáveis de ambiente.
- Definir o contrato comum entre o harness e os provedores.
- Definir como as chaves de API serão armazenadas localmente.

**Status:** concluída parcialmente. A estrutura inicial, configuração e contrato básico do primeiro provedor já existem. Persistência, launcher e adaptadores adicionais permanecem pendentes.

**Concluída quando:** o projeto inicia localmente e existe um contrato documentado para os provedores.

### Fase 1 — Primeiro agente

**Objetivo:** tornar o uso individual funcional.

- Implementar o adaptador inicial do Codex.
- Criar o endpoint local de chat.
- Criar tela de configuração do provedor.
- Criar tela de conversa.
- Exibir estado de carregamento, erros e resposta final.

**Status:** em andamento. O chat local e o endpoint do Codex já foram criados; falta validar uma chamada real com uma chave configurada.

**Concluída quando:** o usuário consegue configurar o Codex e concluir uma conversa local.

### Fase 2 — Histórico e experiência básica

**Objetivo:** transformar o protótipo em uma ferramenta utilizável.

- Adicionar SQLite.
- Salvar conversas e mensagens.
- Listar, abrir e excluir conversas.
- Adicionar instruções/personalidade por agente.
- Registrar tempo de resposta e tokens/custo quando a API fornecer esses dados.

**Concluída quando:** o usuário consegue retomar uma conversa sem perder contexto.

### Fase 3 — Provedores opcionais

**Objetivo:** permitir que o usuário adicione outros agentes sem alterar o núcleo.

- Implementar adaptador Claude.
- Implementar adaptador Gemini.
- Implementar adaptador Ollama.
- Adicionar suporte a APIs compatíveis com OpenAI.
- Criar tela para ativar, desativar e testar provedores.

**Concluída quando:** cada provedor pode ser usado individualmente e falhas de um provedor não interrompem os demais.

### Fase 4 — Comparação e colaboração

**Objetivo:** habilitar uso conjunto sem torná-lo obrigatório.

- Criar modo **Individual** como padrão.
- Criar modo **Comparação**, enviando a mesma tarefa a vários agentes.
- Criar modo **Colaboração**, com etapas como:
  1. Agente executor.
  2. Agente revisor.
  3. Agente consolidador.
- Permitir escolher o provedor em cada etapa.
- Salvar o fluxo e seus resultados no histórico.

**Concluída quando:** o usuário pode usar somente Codex ou montar um fluxo com vários agentes pela mesma interface.

### Fase 5 — Launcher instalável

**Objetivo:** facilitar instalação e manutenção local.

- Criar launcher Pinokio.
- Implementar `install.js`.
- Implementar `start.js`.
- Implementar `update.js`.
- Implementar `reset.js`.
- Criar `pinokio.js` com menus dinâmicos.
- Criar `pinokio.json` e `README.md`.
- Testar instalação a partir de um ambiente limpo.

**Concluída quando:** uma pessoa consegue instalar, iniciar, atualizar e resetar o app sem executar passos técnicos manualmente.

### Fase 6 — Aplicativo desktop

**Objetivo:** distribuir o projeto como aplicativo tradicional.

- Integrar a interface local ao Tauri.
- Criar instalador para Windows.
- Criar ícone, atalhos e armazenamento adequado de configurações.
- Adicionar verificação de novas versões.
- Oferecer atualização automática ou botão de atualização.

**Concluída quando:** o usuário consegue instalar o app como um programa comum no computador.

## 5. Ordem recomendada do primeiro ciclo

1. Criar a estrutura do projeto.
2. Fazer o chat individual funcionar com Codex.
3. Adicionar histórico local.
4. Criar o launcher Pinokio.
5. Testar instalação e atualização.
6. Adicionar um segundo provedor.
7. Implementar comparação entre agentes.

## 6. Fora do escopo inicial

- Hospedagem em nuvem.
- Contas de usuário e autenticação.
- Execução distribuída em servidores.
- Marketplace de agentes.
- Treinamento de modelos.
- Colaboração obrigatória entre provedores.

## 7. Critérios de sucesso do MVP

- O app funciona totalmente localmente.
- Codex pode ser usado sozinho, sem configurar outros provedores.
- Provedores adicionais são opcionais.
- O histórico permanece salvo após reiniciar o app.
- Um novo usuário consegue instalar e iniciar o sistema com pouca orientação.
- A atualização pode ser executada por um fluxo único e documentado.
- Erros de API são exibidos de forma clara e não corrompem o histórico.

## 8. Próximo marco

Construir a **Fase 0 e a Fase 1**, entregando um protótipo local com:

- Tela de configuração do Codex.
- Chat individual.
- Backend local.
- Estrutura preparada para futuros adaptadores.

## 9. Progresso da execução

- [x] Estrutura inicial do projeto.
- [x] Backend local mínimo.
- [x] Interface de chat individual.
- [x] Configuração segura por variável de ambiente.
- [x] Testes de configuração e endpoint de saúde.
- [ ] Persistência do histórico.
- [ ] Launcher Pinokio.
- [ ] Validação com chamada real à API.
