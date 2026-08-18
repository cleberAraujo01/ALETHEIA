# Medição da Fase 1 — cunha comercial

**Aberta em:** 2026-08-17, branch `fase/1-cunha-comercial`.
**Critério de saída (§21.3):** demo "PR aberto → comentário em < 5 min" numa
aplicação de cliente; 3 clientes-piloto; NPS de piloto ≥ 40.
**Estado:** em andamento. Este documento cresce uma seção por fatia, no padrão
da [medição da Fase 0](./medicao-fase-0.md): o que foi medido, contra o quê, o
que ficou de fora.

> **Leia antes de citar qualquer número daqui:** nenhuma fatia da Fase 1 foi
> medida contra aplicação de cliente ainda. O piloto real (juventude na Vercel)
> está bloqueado por *Deployment Protection* — as builds respondem 302 para o
> SSO da Vercel — e depende de decisão de configuração, não de código (§1.4).

## 1. E-06 — `aletheia run` e o shim GitHub Actions (PR #12)

### 1.1 O que foi construído

`aletheia run --base-url --head-url --journey`: captura base, captura head,
diff — nas mesmas funções dos comandos avulsos, extraídas para `ops.ts`. Sai
com `report.json`, `report.html`, `comment.md` (o comentário de PR, mesmos
fatos, por grupo, com o que **não** foi validado) e `summary.json`. Modo de
confiança default `SHARED_DEGRADED`: contra duas URLs vivas a CLI não sabe o
que elas compartilham, e declarar o pior caso é RN-EXE-007.

Shim `shims/github-action/action.yml`: composite, 55 linhas efetivas, três
coisas — autentica com o token do job, invoca `run`, publica (comentário no PR
quando há PR, step summary sempre, artefato). Código de saída `2` vira aviso,
nunca reprovação (RN-CI-005). Zero `if` de negócio (PA-11).

### 1.2 O que foi medido

`.github/workflows/demo-run.yml` roda o shim em todo PR que toca runner, CLI,
motor ou shim, contra o ParaBank público (base = head, o piso mais barato), e
**comenta no próprio PR**. No PR #12:

| Medida | Valor |
|---|---|
| Caminho inteiro no Actions (checkout, install, build, chromium, 2 capturas, diff, comentário) | **~1 min** |
| Orçamento do Tier 1 (RN-CI-003) | 5 min |
| Deltas no piso ParaBank × ParaBank | 2 (1 DOM, 1 rede), 0 bloqueantes |
| Comentário publicado com marcador `<!-- aletheia:run -->` | sim |

O tempo inclui instalar o runner do zero (`pnpm install`, `pnpm build`,
chromium); num cliente com cache de dependências cai. Contra os 5 minutos há
folga de quatro — mas contra **um** site público de seis rotas. A conta que
importa é com jornada de cliente, e ela ainda não existe.

### 1.3 O que ficou declarado

- O comentário é sempre novo. Atualizar o anterior (o marcador existe para isso)
  fica para quando um PR real reclamar do ruído.
- Base = produção e head = preview é a forma honesta de O5 hoje; base = preview
  do commit base entra com o provisionamento efêmero (E-07).
- Três correções de ambiente no caminho até o shim rodar dentro do Actions
  (`pnpm/action-setup` × `packageManager`; escopo do `playwright install`),
  todas no shim, nenhuma no runner. Registradas porque "funciona na minha
  máquina" é exatamente o que um shim precisa provar que não é.

### 1.4 O piloto real, e por que não aconteceu ainda

O juventude está na Vercel. O workflow do cliente (15 linhas, no README do
shim) usa `deployment_status`: preview do PR como head, produção como base. Ao
tentar ligá-lo em 2026-08-17: **produção e previews respondem `302` para
`vercel.com/sso-api`** — *Deployment Protection* ligado —, e o domínio
`aajuventude.com.br` declarado em `config/site.ts` não resolve. Não há URL que
o runner alcance. Para destravar, uma das duas: desligar *Vercel Authentication*
no projeto, ou criar *Protection Bypass for Automation* e ensinar o `capture` a
enviar `x-vercel-protection-bypass` sem que o segredo entre em captura, relatório
ou log (PA-09). Decisão de configuração do dono do projeto; nenhuma linha de
código deste repositório muda o resultado.

## 2. E-03 + E-04 — IR v1 e runner interpretador

### 2.1 O que foi construído

`packages/ir`: schema v1 (`navigate`, `click`, `fill`, `select`, `press`,
`observe`), validador sem dependência externa, formato legado `0.1.0` (lista
de rotas) aceito e migrado na leitura, migração testada **nas duas direções** —
subir é total; descer é recusado, nomeando o passo, quando a IR tem ação que
o formato antigo não representa (migração que perde informação em silêncio é
bug de arquitetura, não conveniência).

Alvo é **fingerprint** (§3.5): `testId`, `role`+`name`, `label`, `placeholder`,
`text` — ao menos um sinal semântico obrigatório; `css` sozinho é recusado pelo
validador. O runner tenta do sinal mais estável ao mais frágil, exige exatamente
um elemento (ou `nth`), e registra em `trace.json` qual sinal resolveu. Essa
coluna é a calibração futura do motor de seletores (E-05): quais sinais
concordam entre si numa aplicação real vem daí, não de palpite.

Segredo é `{ secretRef }`, lido do ambiente na hora e mascarado como
`<secret>` em DOM, rede, console e URL da captura. Passo que falha (alvo não
encontrado, ambíguo, ação recusada) **interrompe** a jornada; a interrupção vai
para dentro da captura (`interruption`, versão `0.3.0`, retrocompatível) e o
relatório declara passo, motivo e observações não produzidas (RN-EXE-013,
PA-10). Não é falha de plataforma: sob O5, o head não alcançar o que a base
alcançou é sinal, e aparece como observação só na base, HIGH.

Sem `sleep`: cada ação converge pela mesma quiescência da Fase 0 (rede + DOM +
animação, com deadline); a espera de acionabilidade do Playwright usa o mesmo
deadline — um orçamento, declarado.

### 2.2 O que foi medido

**Fixture local com browser real** (`apps/runner/src/capture.test.ts`, roda no
CI): formulário com nome, senha, `<select>` e dois links ambíguos.

| Caso | Resultado |
|---|---|
| navigate → observe → fill (label) → fill (secretRef) → select → click (role+name) → observe | 2 observações; `resolvedBy` = `label, label, label, role+name`; **segredo ausente** de DOM, rede, console e URL; página ecoou nome e perfil (a ação aconteceu) |
| alvo inexistente (`button "Sair"`) | jornada interrompida no passo; observação anterior preservada; `missingObservationIds` = `["depois"]` |
| alvo ambíguo (`text "Ver"`, 2 elementos) | falha do passo com `text=2`; com `nth: 1` resolve como `text[1]` e abre o link certo |

**Aplicação real** — login demo do ParaBank (`apps/runner/__fixtures__/journeys/parabank-login.json`:
navigate, observe, fill × 2, click "Log In", observe, click "Log Out", observe),
via `aletheia run` com base = head:

| Medida | Valor |
|---|---|
| Passos | 8 de 8 `ok`; `resolvedBy` = `css, css, role+name, role+name` |
| Convergência por ação | 765 ms (navigate), 266 / 2 ms (fill), 727 / 292 ms (click) |
| Observações comparadas | 3 (home, overview, after-logout) |
| Deltas | 28 · 0 bloqueantes (26 visuais: saldo e datas da conta demo compartilhada mudam entre capturas; 1 DOM; 1 rede) |

O `resolvedBy = css` nos dois `fill` diz algo real: o `placeholder: "Username"`
declarado no fixture não existe na página — o ParaBank não tem placeholder —, e
o runner caiu no complemento CSS. O sinal semântico estava **errado** e o trace
mostrou. É exatamente o tipo de fato que o E-05 vai precisar para escolher
sinais numa aplicação que ninguém instrumentou.

### 2.3 O que ficou declarado

- **Falha de passo é interrupção, não retry.** RN-EXE-010 limita retry a
  categorias transientes já classificadas; nenhuma existe ainda. Quando a
  primeira aparecer num piloto, entra com classificação, não antes.
- **Um sinal por vez, não consenso.** O runner usa o primeiro sinal que casa
  exatamente um elemento. Consenso entre sinais, cura e repositório de
  elementos são o E-05 — e o `resolvedBy` de hoje é o dado que o E-05 vai
  calibrar.
- **`press` sem alvo vai para o teclado da página**; com alvo, para o elemento.
  Não há `hover`, `scroll`, upload, drag: entram quando uma jornada real pedir.
- **O piso do ParaBank com login tem 26 deltas visuais**, todos abaixo do teto
  visual. Conta demo compartilhada muda de saldo entre capturas — é ruído de
  ambiente `SHARED_DEGRADED` (RN-EXE-007), e o comentário do PR diz isso.

## 3. E-05 — seletores multi-sinal, cura proposta, repositório de elementos

### 3.1 O que foi construído

`packages/selector-engine`, puro e determinístico (sem browser; PA-01):
**pesos por sinal** (hipótese declarada: `testId` 1,0 · `role+name` 0,9 · `label`
0,8 · `text` 0,7 · `placeholder` 0,6 · `field` 0,5 · `css` 0,15), **detector de
identificador gerado** (`mui-4821`, `:r1a:`, `css-…`, UUID, hash, sufixo
numérico longo → peso 0,1: vota, mas não decide), **consenso ponderado** — cada
sinal vota nos elementos que casa, o vencedor precisa de pontuação mínima e
margem sobre o segundo — e **proposta de cura** quando um sinal forte declarado
falhou e o consenso resolveu mesmo assim. O runner coleta candidatos com os
`Locator`s do Playwright (semântica de papel, nome, rótulo é a dele), identifica
cada um por XPath calculado na página sem tocar no DOM, e devolve a decisão ao
motor.

**Cura nunca é aplicada** (RN-EXE-011, PA-08). A execução segue com o elemento
que o consenso escolheu; sai `healing.json` com fingerprint declarado, valores
observados no elemento resolvido, proposta, confiança e screenshot do elemento.
Aprovar é uma pessoa copiar `proposal` depois de olhar o screenshot.

**Repositório de elementos** (§12.3): `elements.json` por projeto, `{ "ref":
"el_…" }` na IR, `--elements` na CLI. `stability` (resolvedRuns, healedRuns) é
lido; quem atualiza é quem tem o trace, e isso ainda não existe — declarado.

### 3.2 O que foi medido — corpus de mutações do fixture

O mesmo fingerprint do botão de login (`testId` + `role`+`name` + `text`) contra
a página original e contra mutações que quebrariam qualquer seletor único
(`apps/runner/__fixtures__/site/mut-*.html`, no CI, browser real):

| Página | O que mudou | Desfecho | `resolvedBy` | Cura |
|---|---|---|---|---|
| `index.html` | nada | resolvido, confiança 1,0 | testId+role+name+text | — |
| `mut-reestruturado` | botão envolto em dois `div` | resolvido, 1,0 | testId+role+name+text | — (estrutura não é sinal) |
| `mut-testid-renomeado` | `btn-entrar` → `btn-acessar` | resolvido | role+name+text | **proposta**: `testId: btn-acessar` |
| `mut-texto-mudou` | "Entrar" → "Acessar" | resolvido | testId | **proposta**: `name`/`text: Acessar` |
| `mut-testid-gerado` | testId vira `mui-4821` | resolvido | role+name+text | proposta |
| `mut-tudo-mudou` | testId **e** texto mudaram | **não resolve** — só `text` casaria o `<h1>` | — | — |
| `mut-botao-sumiu` | botão removido | **não resolve** | — | — |

**O corpus mudou o motor antes de o PR fechar.** Na primeira versão,
`mut-botao-sumiu` "resolvia": o botão não existia, mas `text: "Entrar"` casou o
`<h1>Entrar</h1>` da página, e o consenso curou para um cabeçalho — clicou no
nada e seguiu. É o "parecido" que cura silenciosa transforma em falso negativo.
Entrou a regra **cura sem corroboração não resolve**: quando os sinais fortes
falharam, o vencedor precisa de ≥ 2 sinais concordando ou do sinal mais forte
declarado; um secundário sozinho é ambiguidade para um humano olhar.

**Aplicação real** — ParaBank, login/logout via `aletheia run` com o fixture
`parabank-login.json`: 8/8 passos, `resolvedBy` = `field, field, role+name,
role+name`, confiança 1,0 em todos, 0 curas, 3 observações, 2 deltas, 0
bloqueantes. E um segundo achado do real: os campos do ParaBank não têm rótulo
nem placeholder — o único sinal semântico é o `name` do formulário. Entrou o
sinal `field` (0,5), e com ele a regra de que **um único sinal declarado casando
um único elemento resolve** mesmo abaixo do mínimo: o mínimo protege contra
sinal fraco perdido no meio de vários, e ali não há vários.

Taxas no corpus (7 páginas, 1 fingerprint): **resolução 5/5 onde o elemento
existe e é identificável; cura 3/5 dessas, todas com proposta correta; 0
resoluções erradas** — as duas páginas onde o botão não é identificável não
resolvem, que é o desfecho certo. Corpus pequeno e nosso; é o que §7 pede como
rede de baixo, não a medição de campo.

### 3.3 O que ficou declarado

- **Pesos, mínimo (0,6), margem (0,2) e limiar de sinal forte (0,7) são
  hipóteses.** A série que os calibra é `resolvedBy` + `confidence` no trace de
  execuções reais; nenhuma foi ajustada contra dado ainda.
- **Sem cura de verdade aplicada, sem fila de aprovação com UI, sem
  atualização de `stability`.** Tudo isso é dado no trace e no `healing.json`
  esperando consumidor.
- **XPath é identidade de resolução, não seletor gravado**: vive só o tempo da
  decisão e não aparece em lugar nenhum além do motivo de ambiguidade.
- **`text` casa qualquer elemento com aquele texto, cabeçalho inclusive.** É
  correto (é o que o autor declarou) e é por isso que a corroboração existe.

## 4. E-02 — diff de banco somente leitura, por capability

### 4.1 O que foi construído

`packages/capabilities` — spec da §14.3 (YAML), **validador estático léxico
estrito** (um statement, sem comentário, sem palavra-chave que não seja de
leitura, `:nome` obrigatório, tabela após FROM/JOIN e `tabela.coluna` na
allowlist, LIMIT ≤ maxRows), **executor `READ`** com sqlite via `node:sqlite`
aberto em modo somente leitura (privilégio mínimo no próprio engine, não só no
validador), parâmetro nomeado do driver (RN-DAT-002), `LIMIT` compulsório
(RN-DAT-004), PII/SECRET mascaradas por hash estável na borda (RN-DAT-008 —
comparáveis entre base e head, nunca legíveis), auditoria sem valores nem URL
(§14.8). Só `APPROVED` executa; `PROPOSED` é pergunta. `WRITE`/`DESTRUCTIVE`
são recusadas com o motivo (RN-DAT-007, E-07).

Na IR, `observe` ganha `database: [{ capability, params }]` — a jornada nomeia,
nunca escreve SQL. No runner, a captura 0.4.0 carrega o resultado por
observação; a capability que falha vira `error` no resultado (evidência), não
derruba a captura. No motor, a camada `DATABASE`: alinhamento por
`keyColumns` **declaradas** na capability (sem elas, por posição — e o delta
diz `alignedBy: position` e cai um degrau), colunas voláteis **declaradas**
ficam de fora, sonda que falhou de um lado só é `DB_PROBE_FAILED` HIGH, dos
dois lados é LOW (configuração). Na CLI, `--base-db`, `--head-db`,
`--capabilities`, `--db-env`; a URL morre no shim.

### 4.2 O que foi medido

**Suíte de SQL malicioso e malformado** (§7 do CLAUDE.md, no CI): 12 recusas —
segundo statement, comentário, `FOR UPDATE`, `DELETE`, `INTO`, `PRAGMA`,
parâmetro posicional, parâmetro não declarado, tabela e JOIN fora da
allowlist, coluna fora da allowlist, LIMIT acima do teto — mais WRITE em
produção, obrigatório não usado, e literal de string que não engana o
tokenizador. Executor: PII mascarada, auditoria sem e-mail, PROPOSED/ambiente/
parâmetro/inexistente recusados antes de tocar o banco, e **a conexão
somente-leitura recusa escrita mesmo se o validador falhasse** (segunda
barreira, testada).

**Demo `pnpm demo:banco`** — a mesma página estática nas duas builds; dois
sqlite iguais exceto pelo desconto do pedido 42 (15% → 10%), um pedido a mais e
`created_at` diferente:

| Sonda | Delta | Severidade | Por quê |
|---|---|---|---|
| `order.getDiscount(42)` | `DB_FIELD_CHANGED` discount_pct 15 → 10 | **HIGH → REGRESSION** | chave declarada (`id`); é o problema do oráculo do §1, com DOM idêntico |
| `order.getDiscount(42)` | — em `created_at` | — | coluna volátil declarada |
| `order.getDiscount(42)` | — em `customer_email` | — | mascarada por hash, igual dos dois lados |
| `order.listRecent` | `DB_ROWCOUNT_CHANGED` 2 → 3, `DB_ROW_ADDED`, `DB_FIELD_CHANGED` | MEDIUM | sem `keyColumns`: alinhado por posição, e diz |
| `order.countAll` (PROPOSED) | `DB_PROBE_FAILED` dos dois lados | LOW | recusada pelo executor nas duas capturas: configuração, não regressão |

Veredito `REGRESSION_DETECTED`, código 1, comentário de PR com uma linha:
`DB_FIELD_CHANGED · db:order.getDiscount?orderId=42/id=42/discount_pct · 15 → 10`.
A cobertura deixa de listar `DATABASE` como lacuna quando há sonda; sem sonda,
a lacuna diz que é de **declaração**, não de motor.

Bancada dos oito pares idêntica: as capturas da Fase 0 não têm sonda, e o motor
as lê como `database: null`.

### 4.3 O que ficou declarado

- **Léxico, não AST; sem `EXPLAIN`.** O validador erra para o lado de recusar
  (é o único ponto onde a plataforma toca dado persistente). AST e `EXPLAIN`
  (item 4 da §14.3) entram com o adaptador PostgreSQL, quando o primeiro piloto
  o tiver — o adaptador é uma interface de duas funções, e o executor não muda.
- **Só sqlite.** `node:sqlite` é builtin (Node ≥ 22.13), zero dependência
  nativa, e é o que os testes e o demo precisam. Não é o engine de cliente.
- **Base e head são dois bancos**, e o demo os monta iguais de propósito. Em
  piloto real, "base = produção, head = preview" com bancos diferentes vai
  produzir diferença de DADOS que não é regressão — o mesmo problema do modo
  `SHARED_DEGRADED`, agora na sexta fonte. É o que o E-07 (efêmero, template
  clone) existe para resolver, e até lá o relatório diz o modo.
- **Severidades são hipótese** sem par real: campo mudou HIGH, linha HIGH,
  posição MEDIUM, sonda falha de um lado HIGH. Ficam onde estão até um piloto
  ter banco.
- **A cobertura de coluna sem qualificador não é conferida** (`SELECT id FROM
  orders` — o validador não sabe de que tabela é `id`); a allowlist continua o
  teto, e o executor mascara pelo nome da coluna devolvida.

## 5. E-07 — ambiente efêmero via template clone (a metade que é nossa)

### 5.1 O que foi construído

`provisionEphemeralDatabase(template, { strategy, runId })` em
`packages/capabilities/src/executor/` (o único lugar com driver): `template-clone`
em sqlite (cópia do arquivo para um caminho com o `runId` no nome) e em
**PostgreSQL** (`CREATE DATABASE "aletheia_<runId>" TEMPLATE "<origem>"` no
mesmo servidor, §14.6 nível 3), `dispose()` apaga / `DROP DATABASE … WITH
(FORCE)`. `shared-degraded` devolve o banco como está e o relatório diz. PA-06:
não há `afterEach`, não há `DELETE` de rastro — se a execução morrer no meio, o
clone fica órfão com o `runId` no nome para a faxina de ambiente, nunca para
rotina de cleanup do teste.

Adaptador PostgreSQL para o executor: `:nome` → `$n` na borda (o driver é
posicional; o validador já garantiu que não há `$` no SQL, então a conversão é
injetiva), cada consulta numa transação `READ ONLY` com `statement_timeout` da
própria capability via `set_config` parametrizado — escrever falha no engine
mesmo que o validador falhasse (testado). `RunMetadata.dataStrategy` (§15.2,
PA-12) e o comentário de PR declaram a estratégia; `--data-strategy` em
`capture` e `run`. Postgres de serviço no CI: os testes de Postgres **rodam** lá;
sem `ALETHEIA_PG_URL` eles são pulados com o motivo na saída.

### 5.2 O que foi medido

| Caso | Resultado |
|---|---|
| sqlite: clone → executor lê o clone → dispose | clone some, template intacto |
| PostgreSQL (CI e local): template com 1 linha → `CREATE DATABASE … TEMPLATE` → executor lê 42/15 no clone → `UPDATE` pelo adaptador é recusado (`read-only`) → dispose | `pg_database` não tem mais o clone |
| `pnpm demo:banco` (sqlite, `--data-strategy template-clone`) | `DB_FIELD_CHANGED` HIGH, código 1; diretório de clones vazio no fim |
| `pnpm demo:banco --postgres` (`ALETHEIA_PG_URL`) | idem; no servidor sobram só `aletheia_demo_base` e `aletheia_demo_head` (templates) — nenhum `aletheia_run_*` |
| `--data-strategy partition`, engine desconhecido | falha de plataforma com o motivo |

### 5.3 O que ficou declarado — e por que a fatia é "metade"

- **A aplicação por PR não é provisionada por aqui.** §15.4 pede "aplicação +
  banco clonado + dependências virtualizadas" por PR. O banco está feito; a
  aplicação continua vindo da plataforma do cliente (preview URL da Vercel,
  etc.); virtualização de dependências é §12.6, Fase 2+. Por isso o
  `confidenceMode` do demo continua `SHARED_DEGRADED` mesmo com
  `dataStrategy: template-clone`: o relatório diz os dois, e só vira `ISOLATED`
  quando app e dados forem por execução.
- **Quem aponta a aplicação head para o clone é o cliente.** O clone tem URL
  própria; a build do PR precisa recebê-la (`DATABASE_URL`) para que o que a UI
  mostra e o que a capability lê sejam o mesmo banco. No demo a página é
  estática e a sonda lê o clone; num piloto, isso é uma variável de ambiente no
  deploy de preview.
- **`CREATE DATABASE … TEMPLATE` exige template sem conexões e usuário com
  `CREATEDB`.** O erro diz isso. É a restrição do engine, não nossa.
- **`WITH (FORCE)` no `DROP`** derruba conexões penduradas do próprio clone —
  é descarte de ambiente efêmero, não limpeza de dado do cliente.

## 6. Onde a Fase 1 está

As cinco fatias de engenharia do §8 estão feitas e demonstradas. O critério de
saída (§21.3) é comercial — demo em aplicação de cliente, 3 pilotos, NPS ≥ 40 —
e o primeiro piloto real está bloqueado por *Deployment Protection* na Vercel
(§1.4). Código novo, daqui em diante, entra puxado por piloto: PostgreSQL com
`EXPLAIN` e AST, cura aprovada com repositório atualizado, evidência para as
regras de supressão. Tudo o que foi construído nesta fase tem número medido
contra fixture ou contra aplicação pública; **nenhum contra aplicação de
cliente**, e este documento diz isso na primeira linha.
