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
