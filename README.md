# ALETHEIA

Plataforma de Engenharia de Qualidade Autônoma.

- Arquitetura completa: [`docs/ARQUITETURA.md`](./docs/ARQUITETURA.md)
- Instruções para agentes de IA: [`CLAUDE.md`](./CLAUDE.md)
- Decisões arquiteturais: [`docs/adr/`](./docs/adr/)

**Fase atual: 0 — prova de vida do oráculo.** Só existe teste diferencial
(oráculo O5). Sem World Model, sem LLM, sem UI, sem banco.

## Rodar

```bash
pnpm install
pnpm exec playwright install chromium   # necessário para capturar
pnpm build
pnpm test
```

## Observar uma build

```bash
node shims/cli/dist/main.js capture \
  --url https://sua-app.example \
  --journey apps/runner/__fixtures__/journeys/juventude.json \
  --out .aletheia/base --label base --seed 42
```

A jornada é uma lista de rotas. **Não há ações** (clique, digitação): isso é IR
e chega na Fase 1. Nesta fase só se observa o que é alcançável por URL.

## Comparar duas builds

```bash
node shims/cli/dist/main.js diff \
  --base .aletheia/base/capture.json \
  --head .aletheia/head/capture.json \
  --out .aletheia/report --env pr-4471
```

Códigos de saída — o contrato com os shims de CI (RN-CI-005):

| Código | Significado | O shim deve |
|---|---|---|
| 0 | Nenhuma regressão | Aprovar |
| 1 | Regressão detectada | Reprovar — falha real do código sob teste |
| 2 | Falha da plataforma | **Não reprovar.** O problema é nosso, não do cliente |

## Medir precisão e recall

O critério de saída da Fase 0 é numérico, então precisa de instrumento. Depois
de um `diff`, gere o esqueleto de rotulagem, preencha à mão e meça:

```powershell
node shims/cli/dist/main.js measure --report .aletheia/relatorio/report.json --emit-labels .aletheia/relatorio/labels.json
# preencha "label" com REGRESSION, INTENDED_CHANGE ou NOISE em cada delta
node shims/cli/dist/main.js measure --report .aletheia/relatorio/report.json --labels .aletheia/relatorio/labels.json
```

O rótulo nasce vazio de propósito: pré-preencher com o palpite do motor
induziria concordância e contaminaria a medição. Delta sem rótulo não entra na
conta, e amostra incompleta **nunca** atesta o critério de saída.

Saem dois recortes: **bloqueante** (só o que o motor classificou como
`REGRESSION`, que é o que reprova um PR) e **triagem** (todo delta exibido).
Um delta `UNDETERMINED` que era regressão de verdade é falso negativo no
primeiro recorte e acerto no segundo — a distância entre os dois números é a
medida de quanto o motor ainda depende de humano.

## Medição contra aplicação real

Medido em 2026-08-10 contra uma aplicação Next.js em produção — 7 rotas, ~350
nós de DOM por página, 33 requisições, screenshots de página inteira (a maior,
1280×5613), sem um único `data-testid`:

| Experimento | Resultado |
|---|---|
| Mesma build, duas capturas independentes | **1 delta** — um script de analytics de terceiro. Zero deltas de DOM e zero visuais |
| 8 regressões injetadas no artefato (`tools/mutate-capture.mjs`) | **8 de 8 detectadas**, 4 como `REGRESSION` bloqueante |
| Convergência por observação | 435–872 ms, sem nenhum `sleep` |

O falso positivo remanescente é reportado como `UNDETERMINED` e não bloqueia.
Ele produziu uma correção de calibração real, travada em teste: recurso de
terceiro que some não tem o mesmo peso que endpoint próprio que some.

Para reproduzir a medição de recall:

```bash
node packages/diff-engine/tools/mutate-capture.mjs \
  .aletheia/base/capture.json .aletheia/mutado/capture.json
```

## Estado do código

| Componente | Situação |
|---|---|
| `packages/shared` | Erros canônicos, metadados de execução, log estruturado |
| `packages/diff-engine` | Pipeline de 6 estágios; camadas DOM, rede e visual |
| `apps/runner` | Captura via Playwright, convergência sem sleep ([ADR-012](./docs/adr/ADR-012-convergencia-sem-sleep-na-captura.md)) |
| `shims/cli` | Comandos `capture` e `diff`; relatórios JSON e HTML |
| Camada de console | Capturada como evidência, **sem diff** — lacuna declarada |
| Ações na jornada | **Fora de escopo na Fase 0** — depende da IR (Fase 1) |

Duas posturas que parecem omissão e são decisão:

- **O catálogo de supressão está vazio.** Regra sem evidência de corpus é
  palpite sobre o que é ruído, e cada palpite errado é uma regressão que o
  produto deixa de ver sem avisar. O validador falha o build se alguém
  adicionar uma regra com menos de 3 casos reais rotulados.
- **Delta visual nunca bloqueia** ([ADR-013](./docs/adr/ADR-013-camada-visual-nao-bloqueante.md)),
  porque não existe fonte de intenção nesta fase para separar redesenho de quebra.
