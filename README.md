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

## No PR: `aletheia run` e o shim GitHub Actions

`run` é o contrato com os shims de CI (§15.2 da arquitetura): captura base e
head, difere, e deixa prontos `report.json`, `report.html`, `comment.md` (o
comentário do PR — mesmos fatos, agrupado, com o que **não** foi validado) e
`summary.json`. Código de saída: `0` sem regressão, `1` regressão, `2` falha da
plataforma — que o shim **nunca** transforma em reprovação (RN-CI-005).

```bash
node shims/cli/dist/main.js run   --base-url https://sua-app.exemplo.com --head-url https://preview-do-pr.exemplo.com   --journey .aletheia/jornada.json --commit $SHA --base-ref $BASE
```

O shim (`shims/github-action/`) faz três coisas e nada mais: autentica, invoca
`run`, publica (comentário no PR, step summary, artefato). Uso e exemplo com
preview da Vercel em [`shims/github-action/README.md`](./shims/github-action/README.md).

## Observar uma build

```bash
node shims/cli/dist/main.js capture \
  --url https://sua-app.example \
  --journey apps/runner/__fixtures__/journeys/juventude.json \
  --out .aletheia/base --label base --seed 42
```

A jornada é **IR v1** (`packages/ir`, §12.1 da arquitetura): declarativa,
versionada, interpretada pelo runner — nunca código gerado. Cinco ações e uma
observação; o estado da aplicação atravessa os passos:

```json
{
  "irVersion": "1.0.0",
  "id": "jr_login",
  "name": "login",
  "steps": [
    { "id": "st_1", "action": "navigate", "path": "/entrar" },
    { "id": "st_2", "action": "fill", "target": { "label": "E-mail" }, "value": "qa@exemplo.com" },
    { "id": "st_3", "action": "fill", "target": { "label": "Senha" }, "value": { "secretRef": "QA_SENHA" } },
    { "id": "st_4", "action": "click", "target": { "role": "button", "name": "Entrar" } },
    { "id": "st_5", "action": "observe", "observationId": "painel" }
  ]
}
```

- **Alvo é fingerprint, não seletor** (§3.5): `testId`, `role`+`name`, `label`,
  `placeholder`, `text` — ao menos um sinal semântico; `css` só como complemento.
  O runner tenta do sinal mais estável ao mais frágil e registra em `trace.json`
  qual resolveu (`resolvedBy`).
- **Segredo é referência** (`{ "secretRef": "VARIAVEL" }`): lido do ambiente na
  hora, mascarado como `<secret>` em DOM, rede, console e URL da captura (PA-09).
- **Passo que falha interrompe a jornada** e a interrupção vai para dentro da
  captura (`interruption`): o relatório declara quais observações não foram
  produzidas (PA-10). Sob O5, "o head não chegou onde a base chegou" é sinal —
  aparece como observação só na base, HIGH.
- **Sem `sleep`**: cada ação converge por sinais de progresso com deadline
  (PA-07); estourar é `TIMEOUT_CONVERGENCE`, falha de plataforma.
- O formato legado da Fase 0 (`journeyVersion: "0.1.0"`, lista de rotas)
  continua aceito e é migrado na leitura; a migração é testada nas duas direções.

## Comparar duas builds

```bash
node shims/cli/dist/main.js diff \
  --base .aletheia/base/capture.json \
  --head .aletheia/head/capture.json \
  --out .aletheia/report --env pr-4471
```

O relatório lista os deltas **por grupo** — mesma camada, tipo e lugar
estrutural, em qualquer página. Um grupo é uma causa provável (o `alt` que sumiu
de 68 miniaturas é uma linha, não 68), não um commit provado; o veredito diz
"N delta(s) em M grupo(s)". Grupo não muda severidade nem classificação de nada.

Códigos de saída — o contrato com os shims de CI (RN-CI-005):

| Código | Significado | O shim deve |
|---|---|---|
| 0 | Nenhuma regressão | Aprovar |
| 1 | Regressão detectada | Reprovar — falha real do código sob teste |
| 2 | Falha da plataforma | **Não reprovar.** O problema é nosso, não do cliente |

## Medir precisão e recall

O critério de saída da Fase 0 é numérico, então precisa de instrumento. Depois
de um `diff`, gere o esqueleto de rotulagem, preencha à mão e meça. O critério
fala em **regressões**, não em deltas: ao rotular `REGRESSION`, preencha também
`defect` com um identificador do problema, e repita o mesmo identificador em
todos os deltas que vierem dele — senão um link quebrado que aparece em sete
páginas atesta a fase sozinho.

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

## Supressão aprendida — por aplicação, com revisão humana

Rótulo `NOISE` é o único que ensina algo ao motor (RN-ORC-010): "isto vai se
repetir e ninguém quer ver de novo". `INTENDED_CHANGE` é "aconteceu uma vez,
de propósito" e não gera regra, de propósito.

```powershell
# rótulos NOISE de DOM ⇒ regras PROPOSED no arquivo do projeto, com evidência anexada
node shims/cli/dist/main.js suppress propose --report .aletheia/relatorio/report.json --labels .aletheia/relatorio/labels.json --rules .aletheia/suppressions.json --project minha-app --labeled-by qa@exemplo
# o que cada regra suprimiria neste relatório, e a que custo — antes de ativar
node shims/cli/dist/main.js suppress simulate --report .aletheia/relatorio/report.json --rules .aletheia/suppressions.json --labels .aletheia/relatorio/labels.json
# só regras ACTIVE valem, e o motor recusa ACTIVE sem evidência de 3 execuções distintas
node shims/cli/dist/main.js diff --base … --head … --suppressions .aletheia/suppressions.json
```

A regra casa por **esqueleto de caminho** (estrutura sem os nomes) mais camada
e tipo. Nasce `PROPOSED`; para valer, uma pessoa identificada muda o status para
`ACTIVE` no arquivo e preenche `reviewedBy`. Assinatura que também casa com delta
rotulado `REGRESSION` não vira regra. Detalhes e a medição em
[`docs/medicao-fase-0.md`](./docs/medicao-fase-0.md) §10.12.

## Medição de saída da Fase 0

**Critério atingido em 2026-08-11.** Relatório completo, com limites e o que
ficou de fora: [`docs/medicao-fase-0.md`](./docs/medicao-fase-0.md).

Duas builds reais de uma aplicação Next.js em produção (7 rotas, ~350 nós de DOM
por página, sem um único `data-testid`), servidas localmente:

| Experimento | Resultado |
|---|---|
| Mesma build, duas capturas independentes | **0 deltas**, incluindo camada visual |
| 9 defeitos no código-fonte — 5 reconstituídos do histórico real da aplicação, 4 injetados | **9 de 9 visíveis**, **5 bloqueados**, 0% de falso positivo |
| PR real da aplicação, só com mudança intencional | 68 deltas, **nenhum bloqueante** |
| Convergência por observação | 442–1776 ms, sem nenhum `sleep` |

Os dois últimos são medidos em corpora distintos e não se somam: um mede
detecção, o outro mede se o gate reprova quem não errou.

A medição encontrou dois defeitos nossos que nenhuma mutação de artefato
encontraria: um **falso negativo silencioso** (número de telefone trocado num
dígito ficava invisível, porque a normalização de identificador de path era
aplicada também ao `href` de um link) e uma **build inobservável** (uma rota
quebrada travava a convergência e impedia qualquer veredito —
[ADR-014](./docs/adr/ADR-014-resposta-nao-drenada-na-convergencia.md)).

O corpus vive em `packages/diff-engine/__corpus__/juventude/`; a medição é
reproduzível pelos comandos da §9 do relatório. `tools/mutate-capture.mjs`
continua existindo para exercitar o motor isoladamente, mas **não** serve como
evidência de saída de fase: mutar o artefato não passa por build nem navegador.

## Estado do código

| Componente | Situação |
|---|---|
| `packages/shared` | Erros canônicos, metadados de execução, log estruturado |
| `packages/diff-engine` | Pipeline de 6 estágios; camadas DOM, rede e visual |
| `apps/runner` | Captura via Playwright, convergência sem sleep ([ADR-012](./docs/adr/ADR-012-convergencia-sem-sleep-na-captura.md), [ADR-014](./docs/adr/ADR-014-resposta-nao-drenada-na-convergencia.md)) |
| `__corpus__/juventude` | Corpus real de 9 defeitos + medição de saída da fase |
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
