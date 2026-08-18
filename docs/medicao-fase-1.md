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
