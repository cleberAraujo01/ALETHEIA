# O quê e por quê

<!-- O "por quê" é o que a revisão precisa. O "o quê" está no diff. -->

## Princípios tensionados

<!--
Declare qual dos 12 princípios de CLAUDE.md §2 cada mudança PODERIA tensionar,
mesmo que a conclusão seja "nenhum". A pergunta não é retórica: ela é o momento
em que quem escreveu olha o próprio diff pelo ângulo de quem vai revisar.
-->

- Princípio: — · Como foi resolvido:

## Checklist de CLAUDE.md §9

- [ ] Nenhuma chamada de LLM no caminho crítico de execução (PA-01)
- [ ] Nenhum SQL concatenado ou gerado dinamicamente (PA-04)
- [ ] Nenhum `sleep` / `waitForTimeout` / espera fixa (PA-07)
- [ ] Nenhuma rotina de cleanup adicionada (PA-06)
- [ ] Nenhum seletor único hardcoded (§3.5)
- [ ] Nenhum `INSERT` direto para preparação de massa (RN-DAT-010)
- [ ] Nenhum valor de dado real enviado a modelo (PA-09)
- [ ] Nenhuma lógica de negócio em shim (PA-11)
- [ ] `PlatformError` e `QualityVerdict` corretamente distinguidos (RN-CI-005)
- [ ] Metadados completos de execução preenchidos (PA-12)
- [ ] Regra de negócio nova ou alterada refletida em `docs/ARQUITETURA.md` §7
- [ ] Violação de princípio justificada por ADR em `docs/adr/`

## Auto-revisão executada

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm arch:check`
- [ ] `pnpm arch:check:selftest` — obrigatório se o PR mexeu nas regras de arquitetura

---

## Se o PR toca `packages/diff-engine`

**Cole a tabela dos quatro pares.** Um número sozinho não diz nada: detectar mais
é trivial se reprovar todo mundo for aceitável.

Com as capturas já em disco, `pnpm corpora:medir` roda os oito pares e imprime a
tabela pronta; `--antes <dir de uma rodada anterior>` preenche as duas colunas de
uma vez. Ele **avisa e sai com erro** se faltar captura de algum par — par que
falta não é par que passou. Para reconstituir as capturas (clonar, aplicar
defeito, subir servidor, capturar), os comandos estão na §11 de
`docs/medicao-fase-0.md`.

| Corpus | Antes | Depois |
|---|---|---|
| Juventude — 9 defeitos | 48 regr · 5 de 9 bloqueados · 77,6% triagem | |
| Juventude — PR real #1 | 68 deltas · 0 bloqueantes | |
| Juventude — PR real #2 (`910181f`) | 278 deltas · **11 bloqueantes** (falso positivo conhecido, §10.9) | |
| Oscar — 7 defeitos | 26 regr · 4 de 7 bloqueados · 96,5% triagem | |
| Oscar — mudança intencional | 60 deltas · **20 bloqueantes** (falso positivo conhecido, §10.8) | |
| Sauce Demo — 4 usuários (11 defeitos) | 6 de 11 bloqueados · 11 de 11 visíveis · FP 0% (medição F1 §7) | |

- [ ] Nenhum dos quatro piorou
- [ ] Piso de ruído inalterado: juventude 0 · oscar 10 · Sauce Demo 0 · ParaBank 2 · ANBIMA 1, **nenhum bloqueante**

## Se o PR cria ou altera regra de severidade, normalização ou supressão

A §8, a §9 e a §10.2 da medição registram **três** aplicações desconhecidas que
derrubaram regra recém-calibrada. O teste custa dois minutos: duas capturas da
mesma build, sem build e sem login.

- [ ] Piso de ruído rodado em aplicação **fora** do corpus calibrado
- Aplicação usada: —
- Resultado (deltas / bloqueantes): —
- [ ] Zero delta bloqueante — é o mínimo aceitável: build reprovando a si mesma é
      o pior falso positivo possível

## Se o PR adiciona ou ativa regra de supressão

- [ ] Pelo menos **3 casos reais** rotulados como `NOISE`, em **execuções distintas** (§6.4)
- [ ] Caso de regressão adicionado em `packages/diff-engine/__fixtures__/`
- [ ] Impacto medido no corpus antes e depois — nenhuma regra pode reduzir
      detecção verdadeira
- [ ] Se é regra aprendida (`suppressions.json`): `aletheia suppress simulate` com os
      rótulos dos pares de defeito do projeto mostra **detecção perdida 0**, e a tabela
      de simulação de `pnpm corpora:medir` está colada abaixo
- [ ] Se muda status para `ACTIVE`: `reviewedBy` preenchido, e a `description` diz
      **o que o motor deixa de ver** com a regra em vigor
