# Medição da Fase 1 — cunha comercial

**Aberta em:** 2026-08-17, branch `fase/1-cunha-comercial`.
**Critério de saída (§21.3):** demo "PR aberto → comentário em < 5 min" numa
aplicação de cliente; 3 clientes-piloto; NPS de piloto ≥ 40.
**Estado:** em andamento. Este documento cresce uma seção por fatia, no padrão
da [medição da Fase 0](./medicao-fase-0.md): o que foi medido, contra o quê, o
que ficou de fora.

> **Atualização de 2026-08-22:** o bloqueio do §1.4 caiu e **o primeiro demo
> real aconteceu** — PR aberto → comentário em **1 min 37 s** numa aplicação
> de cliente (§9). O que segue valendo: 1 de 3 pilotos, NPS ainda sem medição.

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
ou log (PA-09).

**A metade de código existe desde 2026-08-21:** `--secret-header
nome=VARIAVEL_DE_AMBIENTE` em `capture` e `run` (e o input `secret-header` do
shim). A flag carrega o nome da variável, nunca o valor; o runner envia o
header em toda requisição e trata o valor como segredo — mascarado em DOM,
rede, console, URL **e trace** (o trace gravava a URL de passo sem mascarar;
corrigido e testado junto). Testado contra servidor local que imita o 302 da
Vercel e ecoa o header de propósito: o eco sai `<secret>`. O que resta é a
decisão de configuração do dono do projeto — criar o segredo de bypass no
painel da Vercel (ou desligar a autenticação) — e nenhuma linha de código muda
esse resultado.

> **Destravado em 2026-08-21/22.** O segredo de bypass foi criado no painel,
> gravado como secret do repositório do cliente, o ALETHEIA virou público (o
> shim faz checkout dele com o token do job do cliente — de repo privado o
> checkout falha, e foi exatamente assim que o primeiro run falhou às 20:29Z)
> e a *branch protection* do §11 do CLAUDE.md foi aplicada na sequência.
> O demo medido está no §9.

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

## 7. Terceiro corpus — Sauce Demo, com ações (2026-08-17)

### 7.1 Por quê, e o que é

O piloto real está bloqueado (§1.4) e nada da Fase 1 tinha sido medido contra
defeito de aplicação que ninguém desenhou para o motor. O [Sauce Demo](https://www.saucedemo.com)
resolve os dois de graça: uma loja pública, feita para automação, em que **o
mesmo app é servido com defeitos deliberados conforme o usuário logado**. Base
= `standard_user`; `locked_out_user`, `problem_user`, `error_user` e
`visual_user` são quatro "builds head" com defeitos que a Sauce Labs mantém de
propósito (`origem: DEMO` — um terceiro tipo além de HISTORICO e INJETADO).

A jornada é a mesma para todos (`journey.mjs` gera as cinco): login → listagem
→ ordenar Z–A → dois itens no carrinho → carrinho → checkout → dados →
resumo → Finish → confirmação; oito observações e treze ações. É a primeira vez
que IR, interpretador, consenso, cura e interrupção rodam contra defeito real
fora do fixture. `capture.mjs` captura os cinco usuários mais o rerun da base em
~3 minutos, sem instalar nada.

### 7.2 O que o motor levantou antes de existir rótulo

Como no oscar, a medição veio antes de `faults.mjs`. Os relatórios brutos:

| Head | Deltas | Bloqueantes | O que interrompeu |
|---|---|---|---|
| `locked_out_user` | 67 | 11 | login recusado → `select` do passo 7 não existe |
| `problem_user` | 310 | 9 | sobrenome ignorado → Continue reprova → `Finish` do passo 21 não existe |
| `error_user` | 321 | 11 | — (chega ao fim, mas o pedido não conclui) |
| `visual_user` | 122 | 0 | — |
| `standard_user` × rerun (piso) | 1 → **0** | 1 → **0** | ver 7.4 |

E o consenso resolveu **todos os alvos** por unanimidade (`testId+role+name`,
`testId+placeholder`), exceto um em que o meu fingerprint estava errado (o link
do carrinho não tem papel `link`) — o motor propôs a cura certa (`text: "2"`)
e o fingerprint foi corrigido para `testId + css` antes das capturas.

### 7.3 Defeitos e detecção

Onze defeitos fixados a partir do observado (`faults.mjs`), rotulagem que fecha
para baixo (`label.mjs`, usuário lido de `report.head.label`):

| Usuário | Defeito | Bloqueado | Como / por que não |
|---|---|---|---|
| locked_out | `L1` login bloqueado | **sim** | jornada interrompida → 6 `OBSERVATION_REMOVED` HIGH; a observação `inventory` é a tela de login com erro (nós removidos, HIGH) |
| problem | `P1` link About → 404 | **sim** | `href` mudou → HIGH, em toda página |
| problem | `P2` sobrenome ignorado | **sim** | `checkout-overview` é a tela de dados com "Last Name is required": resumo e lista do carrinho sumiram (HIGH); `complete` ausente (HIGH) |
| problem | `P3` imagens → 404 | não | `src` mudou → MEDIUM; 6 requisições de imagem sumiram → MEDIUM |
| problem | `P4` ordenação ignorada | não | rótulo do seletor e ordem dos itens → texto/atributo MEDIUM |
| error | `E1` Finish não conclui | **sim** | "Thank you", texto e botões da confirmação sumiram (HIGH) |
| error | `E2` ordenação lança erro | **sim** | erro no **console**: o rastreador do app (backtrace) dispara e o CORS do POST aparece — HIGH |
| error | `E3` erro no checkout | **sim** | idem, no passo de dados (causa exata não isolada; sintoma exclusivo do usuário) |
| visual | `V1` layout desalinhado | não | classes `visual_failure`/`align_right`/`misalign` → LOW; pixel → teto visual |
| visual | `V2` **preços errados** | não | `$29.99` → `$96.09` é `DOM_TEXT_CHANGED` MEDIUM — o problema do oráculo do §1 na camada DOM, sem banco para confrontar |
| visual | `V3` imagem → 404 | não | `src` MEDIUM |

**6 de 11 bloqueados, 11 de 11 visíveis, precisão bloqueante 1,000, falso
positivo 0%, piso 0.** O que bloqueia é o que já bloqueava nos outros dois
corpora: rota/link quebrado, conteúdo que some, jornada que não chega. O que
passa é a mesma família de sempre: visual e texto. `V2` merece ser lido duas
vezes — é exatamente o caso para o qual a camada de banco (E-02) existe, e este
app não tem banco para consultar.

### 7.4 O que este corpus ensinou ao motor no primeiro dia

1. **Corpo de rede não observado não é mudança de tipo — virou código.** O
   piso reprovava a si mesmo: um POST de telemetria (`events.backtrace.io`)
   foi abandonado pela página numa captura (`<undrained>`) e drenado na outra
   (JSON 401), e o motor viu `RESPONSE_TYPE_CHANGED` HIGH entre um marcador e
   um corpo. Não observado é lacuna, não delta; a captura já carrega o
   marcador. Custo medido: zero nos oito pares anteriores. É o quarto achado de
   piso em quatro aplicações estranhas — e o quarto que é normalização, não
   severidade.
2. **Rebaixar erro de console "de terceiro" foi recusado de propósito.** A
   primeira leitura dos erros `submit.backtrace.io … blocked by CORS` era
   "widget de terceiro logando erro" — o limite declarado da camada. A segunda
   leitura, olhando ONDE eles aparecem, inverteu: só o `error_user` e o
   `locked_out_user` os produzem, e só nos passos em que o defeito acontece. É
   o rastreador de erros do app disparando **porque** algo quebrou. Uma regra
   de origem teria rebaixado `E2` e `E3`. Ficou de fora, com o motivo aqui.
3. **Lista cujos itens só têm identidade num descendente alinha por posição.**
   Os `div[data-test="inventory-item"]` são todos iguais; a identidade está no
   `item-N-title-link` dentro. Ordenar de forma diferente virou 235 deltas de
   "cada slot com outro produto" em vez de um `DOM_CHILDREN_REORDERED`. É
   achado de alinhamento, declarado; a correção (herdar identidade de
   descendente com `data-test` único) entra com medição própria, porque mexe
   no estágio 2 de todos os corpora.

### 7.5 O que ficou declarado

- Site público de terceiro: os defeitos são os que a Sauce Labs mantém; se
  eles mudarem o demo, `faults.mjs` muda com medição nova.
- `performance_glitch_user` ficou de fora (lentidão deliberada; mede
  convergência, não diff — entra quando RN-EXE-012 tiver medição própria).
- Sem banco: `V2` não tem O6 para confrontar. É o argumento mais concreto que
  este projeto tem para a camada de banco num piloto real.

## 8. Quarto corpus — PRs reais do Vite, preview contra produção (2026-08-17)

### 8.1 Por quê, e o que é

A §10.9 da Fase 0 fechou com o placar de falso positivo contra mudança
legítima medido em **três** PRs reais de duas aplicações, e a supressão
aprendida (§10.12) sem nenhuma regra ativável por falta de execuções
distintas. Faltava fluxo de PR legítimo de verdade, e de outra aplicação. A
documentação do Vite (VitePress) publica um deploy preview público por PR;
base = produção (`vite.dev`, `main`), head = preview. Quatro PRs abertos em
2026-08-17, oito páginas por URL, ~1 minuto por alvo, nenhuma instalação
(`__corpus__/vite-docs/`, `capture.mjs`, `prs.mjs`, `label.mjs`).

Antes de qualquer par, o piso: produção capturada duas vezes.

### 8.2 O piso reprovou a si mesmo — e o achado é o de sempre

| Piso vite.dev | Deltas | Bloqueantes |
|---|---|---|
| antes | 129 | **14** |
| depois de `NORM-NET-010` | 115 | **0** |

Os 14 eram `href` → HIGH, dois por página, todos no widget de anúncio
(`#carbonads`): o anúncio roda a cada carga e o `href` de clique carrega um
token por impressão de 112 caracteres
(`srv.carbonads.net/ads/click/x/GTND427Y…`). A regra de `href` está certa — é
ela que pega o WhatsApp errado do `juventude` (`F8`) — e não se mexe nela. O
que faltava era reconhecer **segmento de caminho opaco** como identidade, não
destino. Regra nova `NORM-NET-010`, estreita de propósito: ≥ 32 caracteres,
só `[A-Za-z0-9]`, com dígito **e** letra fora do hexadecimal. Slug legível tem
separador (`iphone-15-pro-max-256gb`), telefone é só dígito, hash é só hex —
os três continuam comparados, e o teste unitário fixa os contraexemplos.
Vale nos dois propósitos (`VALUE` e `ALIGNMENT`). **Custo: zero nos treze
pares anteriores** (tabela em 8.4). É o quinto achado de piso em cinco
aplicações estranhas; o quinto que é normalização de identidade, não
severidade — a memória do projeto continua certa.

### 8.3 Os quatro PRs — três legítimos e uma build quebrada de verdade

O plano era só PR legítimo. Um dos quatro não era:

| PR | Natureza | Deltas | Bloqueantes | O que são |
|---|---|---|---|---|
| #23230 documenta `server.preTransformRequests` | legítimo | 809 | **45** | 44 nós de conteúdo removidos em `config/server-options` + 1 `href` |
| #23237 documenta `keepProcessEnv` | legítimo | 806 | **6** | 4 nós + 1 `href` de parágrafo deslocado (alinhamento por posição) + 1 `href` atualizado na `main` |
| #23092 explica monorepo watch | legítimo | 1182 | **35** | 31 nós de conteúdo + 3 `href` e 1 link atualizados na `main` |
| **#23201 fail docs build when SSR errors are detected** | **defeito** | 1063 | **56** | 8 páginas × (3 nós do cabeçalho + 3 erros de console + 1 requisição) |

**#23201.** O PR existe porque o `vitepress` novo quebrava páginas sem falhar
o build — e o preview dele é essa build. O motor viu, em cada uma das 8
páginas: o componente de tradução do cabeçalho não renderiza (lista de
idiomas e botão "Change language" removidos, HIGH), o console ganha
`TypeError: Cannot read properties of undefined (reading 'value')` e
"Hydration completed but contains mismatches" (HIGH), e a requisição de ícones
ao iconify perde `languages`. Confirmado fora do motor: `VPNavBarTranslations`
está no HTML da produção e dos outros três previews, e ausente só neste.
Rotulado como `V1-menu-de-idiomas-nao-renderiza`, origem `HISTORICO`:
**1 de 1 bloqueado, precisão 1,000, FP 0%, 8 grupos (um por página), zero
grupo misto.** É uma regressão real, de projeto real, encontrada num PR aberto
sem uma linha de teste escrita — a primeira do projeto que não foi injetada
nem mantida de propósito por ninguém.

**Os três legítimos: 86 bloqueantes, todos falso positivo.** A família é a
sobredeterminada da §10.8 da Fase 0 — conteúdo que a base tem e o head não —,
mas a causa dominante aqui é **do par, não do motor**: o preview é construído
da base do PR, e a produção mostra a `main` de hoje. Um PR de documentação
aberto há três semanas "perde", no diff, tudo o que a `main` ganhou nesse
tempo (a seção "Watching files in node_modules" de `server-options`, links
atualizados). A base certa seria a `main` no `baseSha` do PR, que não está
publicada. Fica registrado como limitação do corpus. A parcela que é do motor
é a de sempre e já está declarada na §7.4: **parágrafo inserido desloca os
irmãos e o alinhamento por posição vê nós removidos e `href` trocado pelo do
vizinho** (os 6 do #23237). Não se mexe em severidade por isso — a ablação da
§10.8 continua valendo.

### 8.4 A bancada, antes e depois

Os treze pares anteriores **idênticos**; os cinco novos entram:

| Corpus | Antes | Depois |
|---|---|---|
| Juventude — 9 defeitos | 232 · 56 bloq · 27 grupos · **6 de 9** · prec 1.000 · FP 0.0% | idêntico |
| Juventude — PR real #2 | 278 · 11 bloq · 5 grupos | idêntico |
| Oscar — 7 defeitos | 289 · 135 bloq · 10 grupos · **6 de 7** · prec 1.000 · FP 0.0% | idêntico |
| Oscar — mudança intencional | 60 · 20 bloq · 1 grupo | idêntico |
| Sauce Demo — 4 usuários | 67/310/321/122 · 11/9/11/0 bloq · **6 de 11** · FP 0.0% | idêntico |
| **Vite docs — PR #23230** | — | 809 · 45 bloq · 41 grupos |
| **Vite docs — PR #23237** | — | 806 · 6 bloq · 6 grupos |
| **Vite docs — PR #23092** | — | 1182 · 35 bloq · 35 grupos |
| **Vite docs — PR #23201 (preview quebrada)** | — | 1063 · 56 bloq · 8 grupos · **1 de 1** · prec 1.000 · FP 0.0% |
| Pisos | juventude 0 · oscar 10 · Sauce Demo 0 · ParaBank 2 · ANBIMA 1 | idem + **Vite 0** (era 14) |

**Placar de falso positivo contra mudança legítima: 117 bloqueantes em 6 PRs
reais de três aplicações** (0 + 11 + 20 + 45 + 6 + 35). Não é para esconder:
é o número que o produto tem hoje contra PR que não quebra nada, e o que
mudou de natureza com este corpus é saber que a maior parcela nova é do par
(preview atrasado da `main`), não da regra.

### 8.5 A supressão aprendida ganhou evidência real — e parou onde deve

O anúncio rotativo é `NOISE` por construção: muda no piso, vai se repetir em
todo PR, e o rotulador diz na `note` o que se aceita deixar de ver (um bug que
quebre o slot do anúncio). `aletheia suppress propose` sobre os quatro PRs e o
piso rotulado:

| Execução | Efeito |
|---|---|
| #23230 | 4 regras novas `PROPOSED` (`img@src`, nome acessível, texto, ordem dos filhos em `#carbonads`) |
| #23237 | as 4 reforçadas — **2 execuções distintas** |
| #23092, #23201, piso | nada: o anúncio calhou de ser o mesmo par (base e head) do #23230, e a evidência deduplica por `deltaId` |

A dedup por `deltaId` é decisão da §10.12 — re-diffar o mesmo par não pode
contar como execução nova — e aqui ela barra evidência que um humano aceitaria
(execuções distintas, mesmo conteúdo). Fica declarado como o custo dessa
escolha; não se afrouxa sem medir. As 4 regras ficam `PROPOSED` com 2
execuções, em `__corpus__/vite-docs/suppressions.json`. É a primeira vez que a
barreira de 3 execuções é testada por dado real, e ela segurou.

### 8.6 O que ficou declarado

- Previews de terceiro: podem sair do ar quando os PRs forem mesclados;
  `prs/<n>.json` guarda `headSha` e `baseSha` para reconstituir a build.
- A base correta de um preview seria a `main` no `baseSha` — não publicada.
  Num piloto real isso não acontece: base e head são as duas builds do PR.
- O piso do Vite é o único piso rotulado (tudo `NOISE` por construção),
  para servir de evidência à supressão aprendida. Ele continua reprovando a
  bancada se tiver bloqueante.
- A ferramenta que o Netlify injeta no preview (`app.netlify.com`,
  `cdn.segment.com`, `bugsnag`) aparece como ~150 requisições LOW por par —
  ambiente, não aplicação. Rotulado, não normalizado: não há regra a
  aprender com isso ainda.
- `MAX_ROUNDS` da quiescência subiu de 8 para 24 (`apps/runner/src/quiescence.ts`):
  o vite.dev faz prefetch em idle e oscilava até o limite de rodadas antes do
  deadline, e a captura caía em `TIMEOUT_CONVERGENCE` por "oscilação" quando o
  que havia era rede lenta. O deadline continua mandando; a mudança só evita
  declarar oscilação cedo demais.

## 9. O primeiro demo real — piloto juventude na Vercel (2026-08-22)

### 9.1 O destravamento, em ordem

1. Segredo de *Protection Bypass for Automation* criado no painel da Vercel
   (o plano Hobby tem o recurso) e gravado como secret do repositório do
   cliente. O valor nunca passou por captura, relatório, log — nem pela
   sessão do assistente que operou o painel.
2. **PR #20**: no gatilho `deployment_status` o payload não traz
   `github.event.pull_request`, e o comentário — o produto da cunha — nunca
   seria publicado no único gatilho que o cliente real usa. O shim passou a
   descobrir o PR pela associação do commit (`/commits/{sha}/pulls`) e a usar
   `github.event.deployment.sha` nos metadados (PA-12). O demo do PR #12 não
   pegou isso porque roda em `pull_request`, no nosso repositório.
3. ALETHEIA público + `pnpm protect`: o primeiro run real falhou no checkout
   (o shim baixa o runner com o token do job do cliente; repo privado → 404).
   Tornar o repo público destravou o piloto E a *branch protection* do §11,
   pendente desde a Fase 0. Ref do runner fixada na tag `piloto-1`.

### 9.2 O que foi medido — o critério da fase, pela primeira vez

PR #2 do `associacaoAtleticaJuventude` (mudança invisível: comentário no
README), 2026-08-22:

| Medida | Valor | Critério |
|---|---|---|
| PR aberto → comentário do ALETHEIA publicado | **1 min 37 s** (02:06:27 → 02:08:04 UTC) | < 5 min |
| Veredito | 🟢 `UNDETERMINED_ONLY`, 0 bloqueante | não bloquear PR inocente |
| Deltas indeterminados | **45**, em 39 grupos | — |

O relatório declarou `SHARED_DEGRADED`, a seção de honestidade (PA-10) e o
agrupamento por assinatura. Nenhum humano interveio entre o `git push` e o
comentário.

### 9.3 Os 45 deltas, dissecados — e as duas regras que nasceram deles

Rotulagem fechada contra as capturas (artefato `aletheia-run` do run
32545361122): **45 de 45 são ruído do PAR preview × produção, zero são da
aplicação.**

- **38 × `RESPONSE_FIELD_CHANGED`**: corpos idênticos exceto pelo **buildId
  do Next.js** (`b8BR8bk…` × `QtLyQum…`), que muda a cada deploy mesmo com
  código idêntico. Ele aparece em posição estrutural fixa: o comentário
  após o doctype (`<!DOCTYPE html><!--token-->`) e o campo `"b"` do flight
  RSC. Hashes de chunk e token `_rsc` foram **determinísticos** — o achado
  em aberto do §8 do CLAUDE.md (o `_rsc` espalhando grupos) não foi o que
  mordeu aqui, e segue em aberto.
- **7 × `REQUEST_ADDED`**: `vercel.live/_next-live/feedback/feedback.js`,
  o toolbar que a Vercel injeta **somente em preview**. Mobília do ambiente,
  não comportamento da aplicação.

Isso é ruído de **plataforma**, não de aplicação — qualquer cliente Next.js
na Vercel produz o mesmo padrão em todo PR. Portanto normalização, não
supressão aprendida (que é por aplicação e exige 3 execuções):

- **`NORM-NET-011` — identidade de deploy declarada pelo framework:** extrai
  o buildId do comentário pós-doctype (exige 16–32 chars, letra E dígito —
  `<!--app-html-->` do Vite não casa) e mascara a ocorrência LITERAL do token
  extraído, lado a lado com o seu par, em corpos e URLs de rede.
- **`NORM-NET-012` — mobília da plataforma de deploy:** requisição ao host
  `vercel.live` (e só ele) sai da comparação, contada no ledger. Netlify e
  afins só entram quando um par real os mostrar.

### 9.4 Custo medido

| Par | Antes | Depois |
|---|---|---|
| **Piloto juventude — PR real #2 (preview × produção)** | 45 deltas · 39 grupos | **0 deltas** |
| Bancada inteira (4 corpora: 8 pares de defeito/PR + 6 pisos + 4 PRs Vite) | — | **idêntica, número por número** |

Detecção inalterada (6/9, 6/7, 6/11, 1/1), FP inalterado, pisos inalterados.
`NORM-NET-011` **atuou** nos pares locais do juventude (84–103 mascaramentos
por par) sem mudar um único delta: os corpos de lá diferem por conteúdo real
além do buildId — a máscara acerta o token, não o corpo. O teste de regressão
(`__fixtures__/vercel-next/`) fixa os dois padrões e o contraexemplo: mudança
real de corpo e sumiço de terceiro comum continuam visíveis.

### 9.5 O que ficou declarado

- O piso de ruído clássico (mesma build contra si mesma) **não exercita**
  estas regras: buildId igual dos dois lados, toolbar igual dos dois lados. A
  evidência delas é o par real do piloto — e é por isso que os números do
  §9.4 saem do par real, não de piso sintético.
- buildId dentro de corpo JSON de API (não string) é caso não medido e não
  coberto — dívida declarada.
- Do critério de saída: demo < 5 min ✅ em aplicação de cliente; **pilotos:
  1 de 3; NPS: sem medição.** A fase continua aberta.

### 9.6 Rodada 2 — o falso positivo que as duas regras destaparam (2026-08-22)

Segundo run real no mesmo PR (`8b82b4f`, run 32546926736), já com
`NORM-NET-011/012` na tag do runner. Os 45 sumiram e, no lugar, **4
`REQUEST_REMOVED` HIGH em 4 grupos — `REGRESSION_DETECTED`, PR bloqueado**,
num app idêntico. Os quatro:
`GET /canais|/escolinha|/quem-somos|/time?_rsc=1p-R_iEY6bj0jY31`.

É o achado que o §8 do CLAUDE.md deixara em aberto desde a Fase 0, agora
mordendo de verdade. O mecanismo, lido nas capturas:

- `_rsc` é o hash do estado do roteador **no momento** do prefetch — dois
  prefetches da mesma rota, disparados de páginas diferentes, carregam
  tokens diferentes. É identidade de contexto, não de destino.
- Os prefetches da home, em idle, caíram na observação **seguinte**
  (`quem-somos`) de um lado e não do outro. Sem fundir tokens, o alinhamento
  vê a mesma rota como duas requisições, e a diferença de timing vira
  `REQUEST_REMOVED` com severidade de endpoint próprio: HIGH.
- O prefetch que a navegação abortou fica com corpo `null`; `null` × payload
  virava `RESPONSE_TYPE_CHANGED` HIGH pela mesma razão.

Três mudanças, todas estreitas e carregadas no relatório:

- **`NORM-NET-013` — contexto de navegação do roteador:** `_rsc` com valor
  de token (nome exato E `[A-Za-z0-9_-]{8,}`) é fundido em `<token>` na URL
  normalizada. `_rsc=1` hipotético não é tocado.
- **Fato `speculative` no delta de rede** (presença de `_rsc` na URL
  normalizada): `REQUEST_REMOVED` e `REQUEST_COUNT_CHANGED` especulativos
  caem para LOW — o análogo de origem própria do analytics de terceiro que
  calibrou `REQUEST_REMOVED`. O delta continua **visível** para triagem;
  sumir com ele seria supressão sem evidência. Endpoint próprio sem a marca
  segue HIGH.
- Corpo `null` de um lado só deixa de ser comparado quando a requisição é
  especulativa; em endpoint de dado, `null` continua sendo "o corpo que
  deixou de existir".

| Par | Antes | Depois |
|---|---|---|
| **Piloto juventude — PR real #2, rodada 2** | 20 deltas · **4 bloq** · 4 grupos de regressão · `REGRESSION_DETECTED` | 20 deltas · **0 bloq** · `UNDETERMINED_ONLY` · 62 fusões `NORM-NET-013` |
| Bancada inteira (18 linhas: 8 pares de defeito/PR, 4 PRs Vite, 6 pisos) | — | **idêntica, número por número** |

Nenhum corpus da bancada é Next.js App Router, logo a regra é neutra ali por
construção — a evidência é o par real, guardado em
`.aletheia/juventude-piloto-rodada2/` (fora do git, como os demais). O teste de
regressão (`__fixtures__/vercel-next/*-jitter.json`) reproduz o mecanismo em
miniatura: prefetch de `/canais` na home do head e na `quem-somos` da base,
com o token do contexto que o disparou e o corpo `null` do abortado.

Declarado: se a navegação de fato quebrar, quem acusa é DOM e console (foi
assim no vite-docs #23201), não a cardinalidade do prefetch. É uma aposta
medida em um par; a série que a confirma ou derruba é a dos próximos runs
do piloto. O caso de um prefetch que **muda de status** (200 → 500) não é
especulativo por timing e continua `STATUS_CHANGED` HIGH.

### 9.7 Rodada 3 — primeira execução da série (2026-09-22)

O que a rodada 2 deixou foi uma aposta medida em um par: prefetch sumido é
timing, e navegação quebrada acusa em DOM e console. A série que a confirma
ou derruba é a dos runs seguintes. Este é o primeiro.

Antes dele, um dado que ficou fora do §9.6 e importa: no mesmo dia da
rodada 2, ainda em `piloto-2` (sem `NORM-NET-013`), o run seguinte do mesmo
PR (`e3beb75`, run 32546999819) veio **`NO_REGRESSION_DETECTED`, 0 deltas,
2813 normalizações**. Mesmo motor, mesmo app, um run bloqueado e o outro
limpo — o próprio par de runs já era evidência de que o bloqueio do
`8b82b4f` era coincidência de timing, não diferença de aplicação.

A rodada 3 sobe o runner para `piloto-3` (squash do #22, `c055507`) e
repete o gesto: merge da `main` na branch do PR e uma linha no README
(`014af5c`, run 35757978318).

| | Rodada 2, 1º run (`8b82b4f`, piloto-2) | Rodada 2, 2º run (`e3beb75`, piloto-2) | **Rodada 3** (`014af5c`, piloto-3) |
|---|---|---|---|
| Veredito | `REGRESSION_DETECTED` | `NO_REGRESSION_DETECTED` | **`NO_REGRESSION_DETECTED`** |
| Deltas · bloqueantes | 20 · 4 | 0 · 0 | **0 · 0** |
| Observações comparadas | 7 | 7 | 7 |
| Normalizações aplicadas | — | 2813 | **2875** |
| Deploy pronto → comentário | — | 1 min 09 s | 2 min 00 s |

Duas leituras, com o peso certo:

- **2875 − 2813 = 62**, e 62 foi exatamente o número de fusões de
  `NORM-NET-013` na re-medição do par da rodada 2 (§9.6). A jornada tem as
  mesmas 7 rotas e o roteador dispara o mesmo padrão de prefetch, então a
  coincidência é esperada — mas é consistência com a regra ter atuado, não
  prova; o relatório não discrimina fusões por regra. Discriminar é uma
  linha no resumo, e entra quando outro run pedir.
- **A aposta ainda não foi exercitada.** Com zero deltas, o run não mostra
  a peça que importa: um prefetch caindo na observação seguinte de um lado
  só e aparecendo como LOW especulativo em vez de HIGH. Isso só se vê no
  run em que o jitter voltar a acontecer. Até lá o que a série diz é
  modesto e verdadeiro: dois runs limpos seguidos num PR idêntico, um
  antes e um depois da regra.

Tempo total do gesto ao comentário: push às 16:55:11Z, deploy pronto às
17:01:38Z, comentário às 17:03:38Z — **8 min 27 s**, dos quais 6 min 27 s
são a fila e a build da Vercel, fora do nosso controle. O intervalo que o
critério da fase mede (deploy pronto → comentário) ficou em 2 min, dentro
dos 5. Browser `chromium/151.0.7922.34`, `SHARED_DEGRADED` declarado,
bloco de honestidade completo (PA-10).

Fica declarado o que continua fora: nenhuma regra de supressão em vigor
(zero evidência rotulada ainda), nenhuma capability de banco na jornada,
e o piloto segue sendo um PR sem mudança de aplicação — o próximo PR real
do juventude que mude algo é o que testa detecção, não ruído.

## 10. Quinto corpus — PRs reais do Excalidraw, par exato (2026-09-22)

A busca por um segundo piloto não achou piloto — achou algo que nenhum
corpus tinha. A integração da Vercel no `excalidraw/excalidraw` registra um
deployment na API do GitHub para **cada commit da `master`**, não só para o
head dos PRs. Logo a base de um PR pode ser o preview do **merge-base
exato**, e base e head passam a diferir só pelo PR. O drift que custou 86
bloqueantes no vite-docs (§8: preview da base do PR contra a `main` de hoje)
deixa de existir por construção.

Receita em `packages/diff-engine/__corpus__/excalidraw/`: jornada IR v1 com
ações (menu principal, tecla `?` para o diálogo de ajuda, "Mais
ferramentas"), `capture.mjs` que resolve merge-base e previews pela API de
deployments, `prs.mjs` com a natureza dos PRs, rotulador que fecha para
baixo. Cinco PRs: três mesclados por mantenedores que não tocam a UI da
jornada (#12143, #12125, #12124), um que reestrutura o diálogo de ajuda
(#12076) e um que mostra o nome do arquivo em toda tela (#12139). Mais o
piso: a base compartilhada `97c68dd` capturada duas vezes.

### 10.1 O que foi medido

| Par | Deltas | Bloqueantes | O que é |
|---|---|---|---|
| #12143, #12125, #12124 — invisíveis à jornada | 23 · 21 · 21 | **0 · 0 · 0** | 17 ids gerados por render, 3 de telemetria, 1–3 de hash de build |
| #12139 — nome do arquivo na UI | 31 | **0** | + 1 nó e 1 região de pixel por observação: o `EditableFileName`, onde o PR diz |
| #12076 — busca no diálogo de ajuda | 85 | **4** | 4 `DOM_NODE_REMOVED` HIGH no diálogo reestruturado; 60 deltas de DOM/pixel ali, todos do PR |
| Piso — mesma base, duas capturas | 20 | **0** | os 17 ids gerados e as 3 de telemetria |
| Bancada anterior (18 linhas) | — | — | **idêntica, número por número** — o corpus só adiciona linhas |

**Falso positivo contra mudança legítima: 4 em 5 PRs, os quatro no PR que
reestrutura exatamente a observação onde aparecem.** É a família da Fase 0
(nó com texto some de uma posição e reaparece noutra; §10.8 da medição da
Fase 0), agora sem drift para disfarçar a causa. Nos três PRs que não tocam
a UI, e no que toca de leve, zero — o placar mais limpo que um PR legítimo
já produziu no motor, e o primeiro em que se pode dizer que o ruído restante
é da aplicação ou do motor, nunca do par.

### 10.2 Três achados, nenhum código

1. **Hash do Vite sem dígito escapa de `NORM-NET-007` de um lado só.** A
   regra exige dígito no hash para não confundir `plugin.controller.js` com
   bundle. O Vite gera base64url de 8 caracteres e uma fração não tem dígito
   (`DVNY-aUO`, `DLRddqGH`, `CjXHWcnA`): o lado com dígito vira
   `index-<hash>.js`, o outro fica literal, e o par vê `REQUEST_REMOVED`
   MEDIUM + `REQUEST_ADDED` LOW onde não há nada. Não bloqueia. É o sexto
   achado de identidade de token em seis aplicações, e o primeiro dentro de
   uma regra que já existia. Ficou registrado aqui e **corrigido no mesmo
   dia, §10.4**, com o cuidado que a forma pedia: aceitar 8 caracteres sem
   dígito não pode ser aceitar `index-Settings.js`.
2. **`deltaId` não carrega valor, e a dedup da supressão aprendida conta
   por ele.** `deltaId = hash(camada, tipo, observação, caminho)`. Os 17 ids
   gerados têm o mesmo caminho em cinco pares de **quatro builds distintas**
   e no piso, com valores diferentes em todos. `suppress propose` criou 5
   regras `PROPOSED` no primeiro PR e não reforçou nenhuma nos outros:
   evidência deduplicada, seis execuções reais contam como uma. O custo foi
   declarado em §8.5 como anti-jogo (re-diffar o mesmo par não conta); aqui
   ele barra pares que são genuinamente distintos. A decisão de desenho
   está em §10.4: "execução distinta" é outro par de capturas — o mesmo
   par re-diffado continua não contando.
3. **Telemetria de terceiro (Sentry, Simple Analytics) é ruído em todo par,
   inclusive no piso, e não vira regra por projeto de propósito.** São 3
   deltas MEDIUM/LOW por par — sessão, timestamp, fingerprint do browser.
   `suppress propose` os ignora ("ruído de rede é normalização ou máscara").
   Nunca bloqueiam.

### 10.3 O que fica declarado

- Não é piloto: não há cliente, PR aberto por alguém que receba o
  comentário, nem NPS. É corpus — o quinto, e o primeiro com par exato.
- A jornada não vê o canvas. Um PR que quebre o desenho sem tocar a moldura
  passa. É o mesmo teto do juventude, dito de outro jeito.
- As capturas ficam fora do git, como as demais; `prs/<n>.json` guarda shas
  e URLs para reconstituir. Se um PR for rebaseado, o merge-base muda e
  `capture.mjs` recusa até `prs.mjs` ser atualizado.
- Os rótulos são de `label.mjs`, com regras declaradas no cabeçalho; a
  revisão humana está pendente e as 5 regras de supressão continuam
  `PROPOSED`, com 1 execução cada.

### 10.4 Os dois achados viraram código (2026-09-22, mesmo dia)

O Cleber pediu para corrigir o que havia a corrigir. Duas mudanças, em PR
único, cada uma estreita e medida.

**Hash sem dígito em `NORM-NET-007`.** A exigência de dígito continua — é o
que separa `plugin.controller.js` de bundle. A exceção é a forma exata do
hash do Vite/Rollup: 8 caracteres base64url, maiúscula e minúscula, e `-`,
`_` ou maiúscula depois da primeira posição. `Settings`, `Dropdown`,
`settings` e `SETTINGS` ficam como estão; `DataGrid` entraria, e o custo é
só `index-DataGrid.js` alinhar consigo mesmo por outro nome. Testes
adicionados nos dois sentidos.

**Dedup da supressão aprendida por par de capturas.** A evidência ganha
`pairId` = captura e instante de cada lado. O mesmo par re-diffado não conta
(o anti-jogo de §8.5 continua); outra captura — de outra build ou da mesma —
conta. Evidência gravada antes de existir `pairId` deduplica só por
`deltaId`, recuando para o conservador. Teste cobre os três casos: re-diff
do mesmo par, outra build com o mesmo caminho, evidência antiga.

| Par | Antes | Depois |
|---|---|---|
| Vite docs #23237 · #23092 · #23201 | 806 · 1182 · 1063 deltas | **792 · 1116 · 929** deltas — bloqueantes e detecção iguais (6 · 35 · 56, 1 de 1) |
| Excalidraw #12143 · #12139 · #12076 | 23 · 31 · 85 deltas | **21 · 29 · 81** — bloqueantes iguais (0 · 0 · 4) |
| As outras 18 linhas, inclusive os 7 pisos | — | **idênticas, número por número** |
| Detecção nos quatro corpora de defeito | 6/9 · 6/7 · 6/11 · 1/1 | **6/9 · 6/7 · 6/11 · 1/1** |

O Vite docs também tinha hashes sem dígito — 14, 66 e 134 deltas de rede que
nunca foram bloqueantes e agora não existem. Nenhuma linha perdeu detecção;
nenhum piso mudou.

`suppress propose` de novo sobre os seis relatórios do Excalidraw: as
mesmas 5 regras, agora com **6 execuções distintas cada** (cinco pares de
quatro builds e o piso). É a primeira vez que a barreira de três é atingida
com dado real. **Continuam `PROPOSED`**: a promoção é edição humana com
`reviewedBy`, e os rótulos vieram de `label.mjs`, não de uma pessoa — a
revisão do Cleber é o que falta, e está declarado no arquivo. As 4 regras do
Vite docs seguem com 2 execuções: foram gravadas sem `pairId` e a dedup
recua para `deltaId`; re-propor sobre a bancada as levaria a 4, mas isso é
decisão de quem revisa, não efeito colateral de PR.
