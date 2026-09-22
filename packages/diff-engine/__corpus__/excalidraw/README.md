# Corpus `excalidraw`

Quinto corpus de referência do Diff Engine, e o primeiro com **par exato**: a
integração da Vercel no [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw)
registra um deployment na API do GitHub para **cada commit da `master`**, não
só para o head dos PRs. A base de cada par é o preview do merge-base do PR;
o head, o preview do head. Base e head diferem só pelo PR — o "drift" que
custou 86 falsos positivos no vite-docs não existe aqui por construção.
Cinco PRs escolhidos em 2026-09-22.

Resultado e leitura: [`docs/medicao-fase-1.md`](../../../../docs/medicao-fase-1.md) §10.

## Por que este corpus

| | `vite-docs` | `excalidraw` |
|---|---|---|
| Base do par | produção (`main` de hoje) | **preview do merge-base do PR** |
| Drift entre base e head | sim — limitação declarada | **não, por construção** |
| Natureza da aplicação | site de documentação, jornada por URL | **aplicação (SPA em canvas), jornada com ações** |
| Ações na jornada | 0 | 4 (menu principal, tecla `?`, Escape, mais ferramentas) |
| PRs legítimos | 3 | **5** — 3 invisíveis à jornada, 2 visíveis |

Custa ~1 minuto por alvo, nenhuma instalação, nenhum login. O que fica
declarado: o desenho em si vive num `<canvas>` e não está no DOM — o que se
compara é a moldura da aplicação (barras, menus, diálogos), a rede e o
console. A UI sai no idioma do browser (pt-BR nas capturas), igual nos dois
lados.

## O que tem aqui

| Arquivo | Papel |
|---|---|
| `journey.json` | IR v1 com ações: home → menu principal → Escape → `?` (diálogo de ajuda) → Escape → "Mais ferramentas". Alvos por `testId` |
| `capture.mjs` | `node capture.mjs 12143 12139 12125 12124 12076 piso` — resolve merge-base e previews pela API de deployments, captura `base-<sha7>` (uma vez por sha) e `pr-<n>`; `piso` recaptura a base compartilhada |
| `prs/<n>.json` | Título, estado, shas, URLs dos previews e arquivos alterados, no momento da captura |
| `prs.mjs` | A natureza de cada PR e em que observações ele é `visivel` |
| `label.mjs` | Um rotulador para os cinco PRs e o piso. Fecha para baixo |
| `suppressions.json` | 5 regras `PROPOSED` do id gerado por render — cada uma com **1** execução (ver abaixo) |

O que **não** tem: capturas e relatórios — se refazem em dez minutos com
`capture.mjs`. Os previews da Vercel podem sumir; `prs/<n>.json` guarda os
shas para reconstituir as builds.

## Os PRs

| PR | Natureza | Visível em | Por quê |
|---|---|---|---|
| #12143 `fix(editor): Tab convert bound arrow update` | legítimo, **mesclado** | — | lógica de binding de elementos |
| #12125 `refactor(editor): split out duplication logic` | legítimo, **mesclado** | — | refatoração interna |
| #12124 `feat: support onDuplicate replacements…` | legítimo, **mesclado** | — | API do pacote |
| #12076 `fix: Add search/filter to HelpDialog` | legítimo, aberto | `help-dialog` | reestrutura o diálogo que a tecla `?` abre |
| #12139 `Display filename on UI` | legítimo, aberto | todas | `LayerUI` está em toda observação |

## Estado (2026-09-22, primeira medição)

| Par | Deltas | Bloqueantes | Leitura |
|---|---|---|---|
| #12143 (invisível) | 23 | **0** | 17 ids gerados + 3 telemetria + 3 hash de build |
| #12125 (invisível) | 21 | **0** | idem |
| #12124 (invisível) | 21 | **0** | idem |
| #12139 (nome do arquivo) | 31 | **0** | + 4 `DOM_NODE_ADDED` LOW e 4 pixels LOW, um por observação, exatamente o `EditableFileName` |
| #12076 (busca na ajuda) | 85 | **4** | 4 `DOM_NODE_REMOVED` HIGH em `help-dialog`: as seções do diálogo mudaram de lugar na reestruturação e o alinhamento por posição as vê removidas. 60 deltas de DOM/pixel no diálogo, todos do PR |
| Piso — base `97c68dd` duas vezes | 20 | **0** | 17 ids gerados + 3 telemetria |

**Falso positivo contra mudança legítima: 4 bloqueantes em 5 PRs, todos no
PR que reestrutura exatamente a observação em que aparecem.** É a família
sobredeterminada da Fase 0 (nó com texto some de uma posição e reaparece
noutra), sem drift para confundir. Nos três PRs invisíveis e no #12139, zero.

## O que este corpus ensinou no primeiro dia

1. **Hash do Vite sem dígito escapa de `NORM-NET-007` — de um lado só.** A
   regra exige um dígito no hash para não confundir `plugin.controller.js`
   com bundle. O Vite gera hashes base64url de 8 caracteres, e uma fração
   deles (`DVNY-aUO`, `DLRddqGH`, `CjXHWcnA`) não tem dígito. Resultado: o
   lado com dígito vira `index-<hash>.js`, o outro fica literal, e o par vê
   `REQUEST_REMOVED` MEDIUM + `REQUEST_ADDED` LOW onde não há nada. Não
   bloqueia; é o sexto achado de "identidade de token" em seis aplicações,
   e o primeiro que a regra existente já cobria pela metade. **Não corrigido
   neste PR** — é regra de normalização, entra com medição própria.
2. **A supressão aprendida conta execuções por `deltaId`, e `deltaId` é
   `hash(camada, tipo, observação, caminho)` — sem os valores.** Os 17 ids
   gerados aparecem, com o mesmo caminho e valores diferentes, em cinco pares
   de quatro builds distintas e no piso. `suppress propose` criou 5 regras no
   primeiro PR e **não reforçou nenhuma nos outros quatro**: mesmo caminho,
   mesmo `deltaId`, evidência deduplicada. Seis execuções reais contam como
   uma. É o custo declarado em §8.5 da Fase 1, agora medido num corpus onde
   ele é claramente conservador demais — decisão de desenho para o Cleber,
   não regra para o motor.
3. **Ruído de rede não vira regra por projeto, de propósito.** Sentry e
   Simple Analytics (sessão, timestamp, fingerprint do browser) são 3 deltas
   em todo par, inclusive no piso; `suppress propose` os ignora ("ruído lá é
   normalização ou máscara"). Ficam MEDIUM/LOW, nunca bloqueiam.

## Reproduzir

```bash
node packages/diff-engine/__corpus__/excalidraw/capture.mjs 12143 12139 12125 12124 12076 piso
pnpm corpora:medir   # entra na tabela: 5 pares + piso, projeto excalidraw
```

Precisa de `gh` autenticado (API de deployments e metadados dos PRs) e dos
previews no ar. Se o merge-base de um PR mudar (rebase), `capture.mjs`
recusa e pede para atualizar `prs.mjs` — a base do par é parte da receita.
