# Corpus `vite-docs`

Quarto corpus de referência do Diff Engine, e o primeiro feito de **PRs reais
de outro projeto, capturados de previews públicos**: a documentação do
[Vite](https://vite.dev) (VitePress) publica um deploy preview por PR em
`deploy-preview-<n>--vite-docs-main.netlify.app`. Base = produção (`main`);
head = preview do PR. Quatro PRs abertos em 2026-08-17.

Resultado e leitura: [`docs/medicao-fase-1.md`](../../../../docs/medicao-fase-1.md) §8.

## Por que este corpus

| | `juventude` | `oscar` | `saucedemo` | `vite-docs` |
|---|---|---|---|---|
| Origem dos pares | commits nossos + injetados | upstream + injetados | defeitos mantidos pelo app | **PRs abertos de projeto real, preview vs. produção** |
| PRs legítimos para o placar de falso positivo | 2 | 1 | 0 | **3** |
| Onde roda | build local | sandbox local | público | **público, sem build nem login** |
| O que exercita a mais | — | token CSRF | ações, interrupção | **anúncio rotativo, drift entre base do PR e `main`, ferramenta de preview injetada** |

Ele custa ~1 minuto por alvo e nenhuma instalação. Era para ser só o placar de
falso positivo contra mudança legítima que a §10.9 da Fase 0 pediu (mais PRs,
de outra aplicação, e evidência de execuções distintas para a supressão
aprendida). Um dos quatro virou outra coisa — abaixo.

## O que tem aqui

| Arquivo | Papel |
|---|---|
| `journey.json` | Oito páginas por URL: home, guia (3), config (3), plugins |
| `capture.mjs` | `node capture.mjs base base-rerun 23230 23237 23092 23201` — produção, produção de novo (piso) e os previews; grava `prs/<n>.json` via `gh api` |
| `prs/<n>.json` | Título, shas, arquivos alterados de cada PR, no momento da captura |
| `prs.mjs` | A natureza de cada PR: `MUDANCA_LEGITIMA` ou `DEFEITO`, com o defeito descrito |
| `label.mjs` | Um rotulador para os quatro PRs e o piso. Fecha para baixo |
| `suppressions.json` | Regras aprendidas do anúncio rotativo — 4 `PROPOSED`, evidência de 2 execuções distintas |

O que **não** tem: capturas e relatórios — se refazem em cinco minutos com
`capture.mjs`. Os previews são do Netlify e podem sumir quando os PRs forem
mesclados ou fechados; `prs/<n>.json` guarda o `headSha` para reconstituir a
build.

## Estado (2026-08-17, primeira medição)

**PR #23201 é uma build quebrada de verdade — 1 de 1 bloqueado, precisão 1,000,
FP 0%.** O PR ("fail docs build when SSR errors are detected") existe porque o
`vitepress` novo quebrava páginas sem falhar o build, e o preview dele é essa
build: o menu de idiomas não renderiza em nenhuma das 8 páginas
(`VPNavBarTranslations` ausente só neste preview), o console tem `TypeError …
reading 'value'` e "Hydration completed but contains mismatches", e a
requisição de ícones perde `languages`. Regressão real de projeto real,
encontrada num PR aberto, sem uma linha de teste escrita — origem `HISTORICO`.

| Par | Deltas | Bloqueantes | Leitura |
|---|---|---|---|
| #23230 (documenta `server.preTransformRequests`) | 809 | **45** | 44 nós de conteúdo removidos em `config/server-options` (drift: a `main` ganhou uma seção que o preview não tem) + 1 `href` de link atualizado na `main` |
| #23237 (documenta `keepProcessEnv`) | 806 | **6** | um parágrafo novo desloca os irmãos e o alinhamento por posição vê 4 nós removidos e 1 `href` trocado pelo do vizinho; + 1 `href` atualizado na `main` (rollup → rolldown) |
| #23092 (explica monorepo watch) | 1182 | **35** | 31 nós de conteúdo (mesmo drift) + 3 `href` e 1 link atualizados na `main` (`baseline` → `web-features`, issue do WSL → issue do Vite) |
| **#23201 (preview quebrada)** | 1063 | **56** | 8 páginas × (3 nós do cabeçalho + 3 erros de console + 1 requisição) — **tudo o defeito** |
| Piso — produção × produção | 129 → **115** | 14 → **0** | ver abaixo |

**Falso positivo contra mudança legítima: 86 bloqueantes em 3 PRs.** É a mesma
família sobredeterminada da Fase 0 — conteúdo que a base tem e o head não —,
agora com uma causa que só este corpus mostra: **o preview é construído da base
do PR, e a produção mostra a `main` de hoje**. Um PR de documentação aberto há
três semanas "perde" tudo o que a `main` ganhou nesse tempo. Não é regra
errada, é o par errado: base certa seria a `main` no `baseSha` do PR, que não
está publicada. Registrado como limitação do corpus, não do motor.

## O que este corpus ensinou ao motor no primeiro dia

1. **Segmento de caminho opaco é identidade, não destino — virou código
   (`NORM-NET-010`).** O piso reprovava a si mesmo com 14 `href` → HIGH: o
   widget de anúncio (`#carbonads`) troca a cada carga e o `href` de clique
   carrega um token por impressão de 112 caracteres. A regra de `href` está
   certa (é ela que pega o WhatsApp errado do juventude); o que faltava era
   reconhecer o token. Forma estreita de propósito — ≥ 32 caracteres, só
   `[A-Za-z0-9]`, com dígito e letra fora do hexadecimal — para não apagar
   slug (`iphone-15-pro-max-256gb`), telefone nem hash. Custo medido: **zero
   nos treze pares anteriores**. Quinto achado de piso em cinco aplicações
   estranhas; quinto que é normalização de identidade, não severidade.
2. **A supressão aprendida ganhou evidência real de execuções distintas** —
   e parou onde deve. O anúncio rotativo é `NOISE` por construção (muda no
   piso); `suppress propose` criou 4 regras e as reforçou com o segundo PR.
   O terceiro PR e o piso mostraram **o mesmo par de anúncios** que o
   primeiro, e a evidência deduplica por `deltaId` (anti-jogo: re-diffar o
   mesmo par não conta). Ficam em 2 execuções, `PROPOSED`, não ativáveis. O
   que se aceitaria deixar de ver está na `note`: um bug que quebre o slot do
   anúncio.

## Reproduzir

```bash
node packages/diff-engine/__corpus__/vite-docs/capture.mjs base base-rerun 23230 23237 23092 23201
pnpm corpora:medir   # entra na tabela: 4 pares + piso, projeto vite-docs
```

Precisa de `gh` autenticado (metadados dos PRs) e dos previews no ar.
