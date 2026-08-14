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
é trivial se reprovar todo mundo for aceitável. Comandos na §11 de
`docs/medicao-fase-0.md`.

| Corpus | Antes | Depois |
|---|---|---|
| Juventude — 9 defeitos | 48 regr · 5 de 9 bloqueados · 77,6% triagem | |
| Juventude — PR real | 68 deltas · 0 bloqueantes | |
| Oscar — 7 defeitos | 26 regr · 4 de 7 bloqueados · 96,5% triagem | |
| Oscar — mudança intencional | 60 deltas · **20 bloqueantes** (falso positivo conhecido, §10.8) | |

- [ ] Nenhum dos quatro piorou
- [ ] Piso de ruído inalterado: juventude 0 · oscar 10 · ParaBank 2 · ANBIMA 1, **nenhum bloqueante**

## Se o PR cria ou altera regra de severidade, normalização ou supressão

A §8, a §9 e a §10.2 da medição registram **três** aplicações desconhecidas que
derrubaram regra recém-calibrada. O teste custa dois minutos: duas capturas da
mesma build, sem build e sem login.

- [ ] Piso de ruído rodado em aplicação **fora** do corpus calibrado
- Aplicação usada: —
- Resultado (deltas / bloqueantes): —
- [ ] Zero delta bloqueante — é o mínimo aceitável: build reprovando a si mesma é
      o pior falso positivo possível

## Se o PR adiciona regra de supressão

- [ ] Pelo menos **3 casos reais** rotulados como `NOISE` (§6.4)
- [ ] Caso de regressão adicionado em `packages/diff-engine/__fixtures__/`
- [ ] Impacto medido no corpus antes e depois — nenhuma regra pode reduzir
      detecção verdadeira
