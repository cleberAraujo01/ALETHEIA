# Como contribuir

> A regra normativa vive em [`CLAUDE.md` §11](./CLAUDE.md). Este documento é o
> passo a passo operacional. Quando os dois divergirem, o `CLAUDE.md` vence.

## O modelo de branches, em dois níveis

```
main                          protegida · sempre verde · só recebe merge de fase
 └── fase/1-cunha-comercial   branch de integração da fase, criada no INÍCIO dela
      ├── feat/ir-schema
      ├── fix/convergencia-resposta-nao-drenada
      └── docs/adr-015
```

| Nível | Nome | Vida | Merge em | Exige |
|---|---|---|---|---|
| Fase | `fase/<n>-<slug>` | toda a fase | `main` | critério de saída atingido + medição documentada |
| Trabalho | `feat/` `fix/` `docs/` `chore/` `refactor/` `test/` | ≤ 3 dias | branch da fase | CI verde + revisão |

**Por que dois níveis e não uma branch de fase apenas.** Uma branch única vivendo
três meses diverge de `main`, e o merge final vira um evento de risco — o pior
momento possível para descobrir um conflito de arquitetura. Branches de trabalho
curtas saindo da branch de fase preservam a ideia de "uma branch por fase" e
eliminam esse risco.

> A Fase 0 foi desenvolvida direto na `main`, antes desta regra existir. Não
> existe `fase/0-oraculo` retroativa. A partir da Fase 1 o modelo vale integralmente.

## Começando uma fase

```bash
git checkout main && git pull
git checkout -b fase/1-cunha-comercial
# no MESMO commit: atualizar CLAUDE.md §8 com escopo permitido,
# escopo proibido e critério de saída da nova fase
git push -u origin fase/1-cunha-comercial
```

## Começando um trabalho

```bash
git checkout fase/1-cunha-comercial && git pull
git checkout -b feat/ir-schema
```

Escopo de commit = nome do pacote (`diff-engine`, `shared`, `runner`, `cli`,
`corpus`, `docs`, `infra`, `deps`, `repo`). O commitlint recusa outros, e a razão
é prática: o escopo responde "que pacote isto pode ter quebrado?" sem abrir o
diff — e num repositório onde mexer no `diff-engine` obriga a reportar precisão e
recall, isso é o que torna a regra verificável.

## Antes de abrir o PR

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm arch:check
```

Depois, à mão — porque nenhuma ferramenta faz por você:

1. Releia o diff inteiro contra o checklist de [`CLAUDE.md` §9](./CLAUDE.md)
2. Releia contra os 12 princípios de §2 e **declare no PR qual princípio cada
   mudança poderia tensionar**, mesmo que a resposta seja "nenhum"
3. Tocou `diff-engine`? Rode `pnpm corpora:medir` e cole a tabela antes/depois
   dos quatro pares. Com as capturas em disco é um comando; produzi-las é a §11
   de `docs/medicao-fase-0.md`. Ele reprova se faltar captura de qualquer par —
   par que falta não é par que passou
4. Criou regra de severidade, normalização ou supressão? Rode o piso de ruído
   numa aplicação **fora** do corpus calibrado. Custa dois minutos e já derrubou
   regra recém-criada três vezes (§8, §9 e §10.2 da medição)

## O que faz um PR ser recusado

- Viola um dos 12 princípios sem ADR que declare **consequências negativas**
- Mexe no `diff-engine` sem número de precisão e recall
- Cria regra de severidade sem piso de ruído em aplicação estranha
- Adiciona supressão sem os 3 casos reais rotulados como `NOISE`, em execuções
  distintas, que §6.4 exige — ou ativa regra aprendida sem `suppress simulate`
  mostrando detecção perdida zero nos pares de defeito do projeto
- Aumenta o orçamento de tempo do CI em vez de paralelizar ou mover para o
  workflow noturno

## Revisão

Todo merge passa por PR: `main` e `fase/*` não aceitam push direto.

> **A proteção não está aplicada hoje.** O repositório é privado e o GitHub cobra
> proteção de branch em repositório privado — as duas APIs devolvem 403. O buraco
> é real: nada impede um `git push` direto na `main`, e o CI só reprova depois do
> fato. Para fechar, torne o repositório público (custo zero) ou assine o Pro, e
> rode `pnpm protect` uma vez.

**Exigência de aprovação está desligada hoje** porque o repositório tem um
contribuidor e o GitHub não permite aprovar o próprio PR — exigir travaria todo
merge, e exigir com bypass de admin seria decoração. `CODEOWNERS` já marca as
três áreas que passam a exigir duas aprovações quando houver uma segunda pessoa:
`packages/diff-engine`, `packages/capabilities` e `scripts/arch-check.mjs`.

**Código escrito por IA passa pela mesma revisão — em especial código escrito por
IA.** O volume que um agente produz por hora é o que torna a revisão
indispensável, não dispensável.

## Ambiente

```bash
pnpm install     # versões fixadas: .npmrc tem save-exact
pnpm build
pnpm verify      # lint + typecheck + test + arch:check
```

Os hooks são instalados pelo `lefthook` no `pnpm install`. Orçamento:
**pre-commit ≤ 5s** (só formata), **pre-push ≤ 60s** (lint, typecheck, test,
arch-check). Hook lento é hook que alguém contorna com `--no-verify`, e hook
contornado não protege nada.
