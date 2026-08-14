# Infraestrutura de qualidade

**Data:** 2026-08-13
**Escopo executado:** Partes 1, 2, 5, 6 e 7 do plano, mais o gate de corpus (3.1).

Este documento existe pelo mesmo motivo que `docs/medicao-fase-0.md`: registrar o
que **não** foi feito e o que ainda é hipótese, antes de registrar o que foi.
Configuração de qualidade envelhece mal quando ninguém sabe por que cada peça
está ali — e a peça que ninguém entende é a primeira a ser desligada quando
atrapalha.

## 1. A régua

Cada ferramenta precisou responder quatro perguntas. **Ferramenta que não
respondeu, não entrou.** Prefere-se uma regra afiada a dez frouxas, porque a
taxa de falso positivo do nosso próprio gate é a coisa mais fácil de perder e a
mais difícil de recuperar — e §10.6 da medição registra 20 falso positivo
bloqueantes ainda abertos no produto. Aplicar a nós um padrão mais frouxo do que
aplicamos ao cliente seria incoerente.

| Ferramenta | Classe que só ela pega | Custo medido | Falso positivo |
|---|---|---|---|
| **prettier** | nenhuma — tira formatação da revisão | 1,2s | zero por construção: corrige, não reprova |
| **eslint** type-aware | promessa solta, `any`, união mal estreitada, `sleep`, `throw new Error` | 5,9s | 3 na calibração, todos resolvidos ou justificados |
| **import-x** | ciclo de import, dependência não declarada — `tsc` não vê nenhum dos dois | incluído | 1 (config minha), corrigido |
| **promise** | `await` esquecido que corrompe convergência (ADR-012) | incluído | zero |
| **commitlint** | escopo de commit que não corresponde a pacote real | 1,9s | zero |
| **arch-check** | **relação entre pacotes**, inclusive transitiva | 0,4s | zero em 6 casos negativos de teste |
| **arch-check selftest** | arch-check quebrado passando despercebido | 1,4s | — |
| **corpus-gate** | queda de detecção dentro do limite que o teste aceita | 0,4s | zero |

## 2. Custos medidos

Máquina local, cache quente. Não são estimativas.

| Gate | Custo | Orçamento | Folga |
|---|---|---|---|
| pre-commit (prettier, arquivos alterados) | **1,2s** | 5s | 3,8s |
| pre-push: lint | 5,9s | | |
| pre-push: typecheck | 5,5s | | |
| pre-push: test | 2,9s | | |
| pre-push: arch-check + selftest | 1,8s | | |
| **pre-push total** | **≈16s** | 60s | 44s |
| build | 2,4s | | |
| format:check | 1,2s | | |
| corpus:gate | 0,4s | | |
| **soma dos passos do `ci.yml`** | **≈20s** | **5 min** | grande |

O orçamento de 5 minutos do `ci.yml` é o mesmo que RN-CI-003 impõe ao produto
para o cliente. **Se estourar, paralelize ou mova para `deep.yml`; não aumente o
limite.** Aumentar é a decisão que transforma o gate em algo que o time aprende a
contornar — que é exatamente a falha que este produto vende para o cliente evitar.

### Medido no CI de verdade

Os números acima são locais, com cache quente. O CI paga instalação e build frio
a cada execução. Primeira execução real, em `ubuntu-latest`:

| Workflow | Job | Duração | Orçamento |
|---|---|---|---|
| `ci.yml` | `verificacao` | **46s** | 5 min |
| `corpus.yml` | `medicao` | **27s** | 15 min |

Folga de mais de 6× no gate que importa. Há espaço para a Parte 3 e a Parte 4
entrarem sem tocar no limite — que era exatamente o ponto de medir antes de
prometer.

## 3. O que foi deliberadamente deixado de fora

Esta seção é a razão de o documento existir.

| Ferramenta | Por que não entrou |
|---|---|
| **changesets** | Nada é publicável até a Fase 1. Versionamento de pacote sem pacote publicado é cerimônia. |
| **commitizen** | O commitlint já recusa o que está errado. Um assistente interativo para gerar a mensagem não pega nada a mais. |
| **Stryker** (mutação) | Responde a pergunta certa — "nossos testes detectariam se a regra estivesse errada?" — e é caro. Fica para quando `normalize` e `score` estabilizarem: hoje eles ainda mudam a cada corpus novo, e o score de mutação mediria um alvo em movimento. |
| **CodeQL** | 6.803 linhas, sem entrada de rede, sem autenticação, sem execução de código de terceiro no caminho de gate. Não há superfície para ele encontrar. Entra quando o control-plane nascer. |
| **Semgrep** | As três regras próprias pedidas (PA-04, PA-07, RN-CI-005) já existem em ESLint e no `arch-check`, com mensagem que explica o princípio. Uma segunda ferramenta cobrindo o mesmo é custo de manutenção sem cobertura nova. |
| **osv-scanner / `pnpm audit`** | Não é discordância — é sequência. Entra na Parte 4, que não foi executada nesta rodada. |
| **gitleaks** | **O que eu adicionaria primeiro** se a Parte 4 entrar: custo ~2s, pega segredo commitado, e nenhuma outra peça aqui pega isso. |
| **SBOM (CycloneDX)** | Requisito de venda para cliente regulado (§18). Não há release. |
| **license-checker** | Faz sentido quando houver distribuição. |
| **Dependabot / Renovate** | Sem ele, dependência envelhece em silêncio — este é o item cuja ausência mais incomoda. Ficou fora só porque a Parte 4 não entrou. |
| **dependency-cruiser** | O `arch-check` próprio faz o mesmo e permite mensagem que cita o princípio e explica o motivo. Uma dependência a menos. |
| **`Redacted<T>` (PA-09)** | **Impossível hoje:** `packages/model-gateway` não existe. É a primeira coisa a fazer quando ele nascer — a assinatura dele deve aceitar exclusivamente `Redacted<T>`, para que enviar payload bruto a um modelo seja erro de compilação e não achado de revisão. |
| **Tipo ramificado para dinheiro** | A Fase 0 não manipula valor monetário. Regra sem alvo é regra que ninguém mantém e todos contornam. |
| **Limiar de cobertura** | Cobertura é medida e publicada por pacote, sem gate. Limiar agora seria número inventado (CLAUDE.md §10); entra quando houver série histórica para ancorá-lo. |

## 4. O que é hipótese aguardando calibração

- **O discriminador de PA-07 é a aridade do executor da Promise.** `new Promise(r => setTimeout(r, N))` é sleep; `new Promise((_resolve, reject) => setTimeout(() => reject(…)))` é o deadline correto do ADR-012. **Limite conhecido:** um executor de dois parâmetros que resolva no timeout escapa da regra. Se aparecer na prática, o caminho é o `arch-check`, não afrouxar o ESLint.
- **O orçamento de 60 linhas por shim nunca foi exercitado**, porque só existe `shims/cli`, que está isento por ser a CLI (CLAUDE.md §4 a chama de fonte da verdade). O número vem de §6.2 e continua sendo hipótese até o primeiro shim de provedor de CI existir.
- **A lista de origens de modelo do `arch-check`** (openai, anthropic, google, cohere, mistral, ollama, langchain, `ai`) é enumerada à mão. SDK novo que não esteja nela passa. Mitigação parcial: `@aletheia/model-gateway` também está na lista, e a intenção é que todo acesso a modelo passe por ele.
- **`no-restricted-syntax` para `throw new Error`** assume que os erros canônicos vivem em `packages/shared`. Se a organização mudar, a regra precisa mudar junto.

## 5. Limites conhecidos, sem eufemismo

**A proteção de branch não está ativa.** O repositório é privado e o GitHub cobra
proteção de branch — clássica e rulesets — em repositório privado; as duas APIs
devolvem `403`. **Nada impede um `git push` direto na `main` hoje.** O CI ainda
roda e ainda reprova, mas depois do fato. Para fechar: tornar o repositório
público (custo zero) ou assinar o Pro, e rodar `pnpm protect` uma vez.

**A exigência de aprovação está em zero.** Um contribuidor, e o GitHub não
permite aprovar o próprio PR: exigir 1 travaria todo merge, e exigir com bypass
de admin seria decoração — que é como esse tipo de proteção costuma morrer. O
`CODEOWNERS` já marca `packages/diff-engine`, `packages/capabilities` e
`scripts/arch-check.mjs` como áreas de duas aprovações, para o dia em que houver
segunda pessoa.

**Metade das regras do `arch-check` é tripwire.** Os pacotes que elas protegem —
`model-gateway`, `capabilities`, `invariants`, `ir` — não existem. Elas não podem
falhar hoje. A saída do comando marca cada uma com `○` e avisa explicitamente
para não confundir "não falhou" com "foi verificado".

**O gate de corpus roda o corpus sintético, não os reais.** Capturas reais pesam
2,5–6 MB cada e §11 da medição registra a decisão de não versioná-las;
reconstituí-las no CI exigiria clonar duas aplicações, subir Django e rodar
Playwright. **Verde no `corpus.yml` não significa "a medição foi feita"** — ela
continua sendo obrigação de quem abre o PR, e o template de PR cobra a tabela dos
quatro pares com os números de hoje já preenchidos.

**`deep.yml` nunca rodou.** O `ci.yml` e o `corpus.yml` já executaram e passaram
(46s e 27s); o noturno só dispara às 03:00 UTC ou por `workflow_dispatch`.

**As duas primeiras execuções do CI falharam, e a culpa foi da configuração.**
`verificação` e `medição` como IDs de job: o GitHub Actions só aceita
`[A-Za-z0-9_-]` em id de job e **rejeita o arquivo inteiro** quando há acento —
nenhum job chega a rodar, e a mensagem é o genérico "This run likely failed
because of a workflow file issue". Custou uma execução vermelha para descobrir, e
fica registrado porque é a terceira vez nesta rodada que uma ferramenta falhou
por configuração e não por conteúdo.

## 6. Uma coisa que a configuração encontrou no próprio repositório

A primeira execução do ESLint deu **535 problemas**, e quase nenhum era do
código: 286 vinham de resolver de import mal configurado por mim, e 103 de um
`tsconfig.lint.json` que herdava `lib: ES2023` enquanto `apps/runner` declara
`DOM` — o ESLint via `document` como `any` e despejava `no-unsafe-*` em cascata.
Mais 80 de `restrict-template-expressions` reclamando de `${numero}`, que é
seguro.

O auto-fix de `consistent-type-imports` então gerou `import type { A, type B }`,
sintaxe inválida, em três arquivos, e **quebrou o build**.

Vale registrar porque é a mesma lição da §10.3.1 da medição, noutro contexto:
**ferramenta mal configurada não produz barulho evidente, produz achado
plausível.** Um "103 problemas de tipagem insegura no runner" parece um
diagnóstico; era configuração errada. Se a resposta tivesse sido silenciar a
regra em vez de investigar, o repositório teria ficado com uma regra desligada e
uma explicação falsa para isso.

## 7. Como isso se conecta ao produto

O desenho do CI é o mesmo dos Tiers de `ARQUITETURA.md` §15.3, e a escolha é
deliberada: **rápido e bloqueante no PR, caro e não-bloqueante à noite.**
Aplicamos a nós mesmos a arquitetura que vendemos. O orçamento de 5 minutos do
`ci.yml` é literalmente o número que RN-CI-003 promete ao cliente — e um projeto
que não consegue respeitá-lo no próprio repositório não tem autoridade para
prometê-lo a ninguém.
