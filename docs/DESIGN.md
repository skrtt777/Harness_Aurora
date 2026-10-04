# Design do Harness Aurora (desktop)

Referência: o app de desktop do Hermes Agent (Nous Research). A regra geral é **uma fonte por assunto, tokens em vez de valores soltos, plano em vez de caixas**.

## Princípios

1. **Plano, sem caixas.**
   - Nada de cartão dentro de cartão.
   - Os grupos se separam por espaço e, quando precisa, por uma linha fina (`--stroke-3`/`--stroke-4`).
2. **Tokens, não valores.** Cores, tamanhos, raios e sombras vêm de `frontend/src/tokens.css`. Os componentes usam `var(--…)`, nunca um hexadecimal solto.
3. **Uma peça por função.**
   - Botão: `.btn`, com as variantes `-primary`, `-ghost`, `-text`, `-danger` e `-sm`, mais `.btn-icon` para ícones.
   - Campos de texto e seleção: `.field`.
   - Escolhas curtas e exclusivas: `.segmented`.
   - Liga/desliga: `.switch`.
   - Linha rótulo + controle: `.row`.
   - Rótulos curtos: `.badge`.
   - Antes de criar uma peça nova, use uma dessas.
4. **Texto pela opacidade de uma única cor.**
   - Níveis: `--text-1` (principal), `--text-2`, `--text-3` (descrições) e `--text-4` (metadados).
   - **Tamanho mínimo: 12 px.**
5. **Um único destaque:** `--accent` (verde-água da Aurora).
   - Vermelho, amarelo e verde servem só para estado: erro, aviso, aprovado.
6. **O chat é a tela principal.**
   - Memória e Skills são páginas fixas na barra lateral.
   - Configurações abre como página com navegação própria.
   - Visualizações e testes (Atlas 3D, cena de teste) ficam dentro da página a que pertencem, não na navegação principal.
7. **Ações aparecem quando servem.**
   - As ações de cada linha da barra lateral e das respostas aparecem ao passar o mouse ou com o foco do teclado.
   - O conteúdo em si nunca muda de lugar por causa delas.

## Tokens (resumo)

| Grupo | Tokens |
|---|---|
| Superfícies | `--bg-sidebar` < `--bg-chrome` < `--bg-surface` < `--bg-elevated` |
| Texto | `--text-1` … `--text-4` |
| Linhas | `--stroke-1` … `--stroke-4` |
| Preenchimentos | `--fill-hover`, `--fill-active`, `--fill-soft`, `--accent-soft` |
| Tipografia | `--fs-xs` 12 · `--fs-sm` 13 · `--fs-md` 14 · `--fs-lg` 16 · `--fs-xl` 20 · `--fs-2xl` 26 |
| Forma | `--radius-sm` 4 · `--radius-md` 6 · `--radius-lg` 10 · `--radius-xl` 14; `--shadow-pop` para menus flutuantes |
| Layout | `--sidebar-width` 248 · `--content-width` 760 (coluna do chat) · `--page-width` 880 |

## Estrutura dos arquivos

| Arquivo | Conteúdo |
|---|---|
| `tokens.css` | Tokens e peças base |
| `layout.css` | Esqueleto do app e barra lateral |
| `chat.css` | Conversa e campo de mensagem |
| `pages.css` | Configurações, Memória e Skills |
| `styles.css`, `conversation.css`, `history.css` | **Legado.** As regras são removidas à medida que cada tela migra; os arquivos novos vêm depois deles e prevalecem até lá. |

## Checklist antes de entregar uma tela

- [ ] Só tokens: nenhuma cor, tamanho de fonte ou sombra solta.
- [ ] Peças base reaproveitadas, sem botão ou campo feito à mão.
- [ ] Sem caixa dentro de caixa, e sem borda onde o espaço já separa.
- [ ] Nenhum texto abaixo de 12 px.
- [ ] Testado em 1440 px e em 390 px (largura de celular), sem rolagem horizontal.
- [ ] Testes de interface (`test/ui.test.js`) passando.
