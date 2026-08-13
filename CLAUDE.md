# CLAUDE.md

> Instruções operacionais para agentes de IA (Claude Code, Cowork, ou qualquer assistente) que trabalharem neste repositório.
> **Leia integralmente antes de escrever qualquer linha de código.**
> Documento de arquitetura completo: [`docs/ARQUITETURA.md`](./docs/ARQUITETURA.md)

---

## 1. O que é este projeto

**ALETHEIA** é uma plataforma de Engenharia de Qualidade Autônoma.

Ela **não** é uma ferramenta de automação de testes. A distinção é operacional, não retórica, e determina praticamente toda decisão de código:

| Não estamos construindo | Estamos construindo |
|---|---|
| Um gravador de passos | Um **World Model** — grafo semântico versionado da aplicação do cliente |
| Um gerador de scripts | Um motor que **descobre verdades verificáveis** e avisa quando deixam de valer |
| Um agente que executa testes | Um sistema onde **o LLM propõe e o código determinístico dispõe** |

O artefato central do produto é o World Model, não o teste. Casos de teste são **artefato derivado e descartável**.

### O problema que o projeto resolve

O **problema do oráculo**: um sistema que apenas observa a aplicação nunca descobre que o desconto deveria ser 15% e não 10%. A tela renderiza, a API devolve 200, o fluxo completa, e o cálculo está errado.

Toda decisão técnica aqui existe para responder: **de onde vem a verdade contra a qual julgamos o comportamento observado?**

As três estratégias que dispensam oráculo humano — e que são o coração do produto:
1. **Teste diferencial** (base vs. head, diff semântico)
2. **Relações metamórficas** (propriedades entre execuções)
3. **Invariantes de sistema** (verificados em toda execução)

---

## 2. Princípios invioláveis — verifique antes de todo PR

Estes têm força de lei. **Um PR que viole qualquer um deve ser rejeitado, mesmo que os testes passem.**

| # | Princípio | Verificação prática |
|---|---|---|
| **PA-01** | LLM propõe, determinístico dispõe | Nenhuma chamada de modelo no caminho de execução de gate |
| **PA-02** | World Model é a fonte da verdade | Nenhum componente mantém estado semântico próprio |
| **PA-03** | Leitura antes de escrita | Nova funcionalidade de dados começa por `READ` |
| **PA-04** | A IA nunca recebe uma conexão | Toda operação de banco via capability compilada |
| **PA-05** | Determinismo em gate, criatividade fora | Exploração e hipóteses só em Tier 3 assíncrono |
| **PA-06** | Descartabilidade, não limpeza | Nunca escrever rotina de cleanup |
| **PA-07** | Sleep é proibido | Zero `sleep`, `waitForTimeout`, `Thread.sleep` |
| **PA-08** | Cura nunca é silenciosa | Toda auto-correção gera registro auditável |
| **PA-09** | Dado sensível não cruza fronteira | Mascaramento na borda do conector |
| **PA-10** | Honestidade sobre cobertura | Relatório declara o que **não** foi validado |
| **PA-11** | Um runner, muitos shims | Zero lógica de negócio em shim de CI |
| **PA-12** | Todo veredito é reproduzível | `runId` reconstitui a execução inteira |

Alterar qualquer um exige **ADR formal** em `docs/adr/` e aprovação do arquiteto responsável.

---

## 3. Padrões proibidos — rejeição automática

Estes são erros que um assistente de IA comete naturalmente por serem idiomáticos em outros contextos. **Aqui são bugs de arquitetura.**

### 3.1 Nunca: LLM no caminho crítico

```typescript
// ❌ PROIBIDO — viola PA-01
async function verificarResultado(page: Page, esperado: string) {
  const dom = await page.content();
  const veredito = await llm.ask(`O resultado está correto? ${dom}`);
  return veredito.includes("sim");
}

// ✅ CORRETO — veredito determinístico; LLM apenas explica depois
async function verificarResultado(ctx: RunContext) {
  const deltas = await diffEngine.compare(ctx.base, ctx.head);
  const veredito = classifier.classify(deltas);        // regras, determinístico
  if (veredito.needsExplanation) {
    veredito.narrative = await narrator.explain(veredito); // LLM só narra
  }
  return veredito;
}
```

### 3.2 Nunca: SQL construído ou emitido dinamicamente

```typescript
// ❌ PROIBIDO — viola PA-04, RN-DAT-001, RN-DAT-002
const sql = await llm.generateSql(pergunta);
const rows = await db.query(sql);

// ❌ PROIBIDO — concatenação
const rows = await db.query(`SELECT * FROM orders WHERE id = '${orderId}'`);

// ✅ CORRETO — capability compilada, aprovada e parametrizada
const rows = await capabilities.execute("order.getDiscount", { orderId });
```

### 3.3 Nunca: espera por tempo fixo

```typescript
// ❌ PROIBIDO — viola PA-07, RN-EXE-005
await page.waitForTimeout(3000);
await sleep(2000);

// ✅ CORRETO — convergência com deadline e sinais de progresso
await converge({
  capability: "order.exists",
  params: { correlationId },
  deadline: "15s",
  progressSignals: [
    { type: "otelSpan", name: "OrderProjection.handle", state: "ended" },
    { type: "consumerLag", topic: "order.created", condition: "advanced" },
  ],
});
```

Se você acredita que um `sleep` é inevitável, **pare e abra uma issue**. É sinal de que falta um sinal de progresso observável — o que é, por si só, informação valiosa sobre a aplicação.

### 3.4 Nunca: cleanup

```typescript
// ❌ PROIBIDO — viola PA-06
afterEach(async () => {
  await db.query("DELETE FROM orders WHERE test_flag = true");
});

// ✅ CORRETO — ambiente descartável
const env = await provisioner.acquire({ strategy: "template-clone" });
try { /* … */ } finally { await env.dispose(); }
```

### 3.5 Nunca: seletor único

```typescript
// ❌ PROIBIDO — quebra no próximo deploy
await page.click("#mui-4821 > div > button:nth-child(3)");

// ✅ CORRETO — fingerprint multi-sinal, resolvido por consenso
await runner.act({ action: "click", targetRef: "el_btn_finalizar" });
```

### 3.6 Nunca: `INSERT` direto para preparar massa

```typescript
// ❌ PROIBIDO — viola RN-DAT-010; bypassa validação e eventos de domínio
await db.query("INSERT INTO orders (id, status, total) VALUES (…)");

// ✅ CORRETO — hierarquia: API → factory → snapshot → SQL (último recurso)
const order = await fixtures.create("order.paid", { strategy: "API" });
```

### 3.7 Nunca: lógica de negócio em shim de CI

```yaml
# ❌ PROIBIDO — viola PA-11
- run: |
    if [ "$CHANGED_FILES" contains "payment" ]; then
      npx aletheia run --suite=payment --strict
    fi

# ✅ CORRETO — o shim só invoca; a decisão é do control plane
- run: aletheia run --commit=$SHA --base=$BASE --env=$URL
```

### 3.8 Nunca: valor de dado real no contexto do modelo

```typescript
// ❌ PROIBIDO — viola PA-09, RN-DAT-009, RN-SEC-007
const rows = await capabilities.execute("user.getAll", {});
await llm.ask(`Analise estes usuários: ${JSON.stringify(rows)}`);

// ✅ CORRETO — forma, tipo, cardinalidade; nunca valores
const shape = schemaProfiler.profile(rows);   // { email: {type:'string', pii:true, cardinality:'high'} }
await llm.ask(`Analise esta estrutura: ${JSON.stringify(shape)}`);
```

---

## 4. Estrutura do repositório

```
aletheia/
├─ apps/
│  ├─ control-plane/     API, orquestração, calibração, billing
│  ├─ web/               Web App — 3 modos (Intenção, Curadoria, Interrogatório)
│  └─ runner/            binário/container de execução
├─ packages/
│  ├─ ir/                schema da IR, validação, migração de versão
│  ├─ world-model/       cliente de grafo, consultas, versionamento
│  ├─ diff-engine/       normalização, alinhamento, supressão  ← componente crítico
│  ├─ selector-engine/   fingerprint multi-sinal, consenso, cura
│  ├─ capabilities/      compilador, validador estático, executor
│  ├─ invariants/        catálogo e verificador
│  ├─ oracles/           diferencial, metamórfico, reconciliação
│  ├─ ingestors/         static, runtime, production, requirements, schema
│  ├─ model-gateway/     abstração de provedor, orçamento, redaction
│  ├─ connectors/        interface canônica + adaptadores
│  └─ shared/            tipos, telemetria, erros canônicos
├─ shims/
│  ├─ cli/               ← fonte da verdade; construir e alterar primeiro
│  ├─ github-action/
│  ├─ gitlab-template/
│  ├─ azure-task/
│  ├─ jenkins-plugin/
│  └─ bitbucket-pipe/
└─ docs/
   ├─ ARQUITETURA.md     documento completo
   └─ adr/               decisões arquiteturais
```

### Onde o LLM pode e não pode aparecer

| Pacote | LLM permitido? |
|---|---|
| `packages/diff-engine` | ❌ Nunca |
| `packages/selector-engine` | ❌ Nunca em runtime |
| `packages/invariants` | ❌ Nunca |
| `packages/capabilities` (executor) | ❌ Nunca |
| `packages/ir` | ❌ Nunca |
| `apps/runner` (caminho de gate) | ❌ Nunca |
| `packages/oracles` (classificação) | ⚠️ Só para explicar, nunca para decidir |
| `apps/control-plane` (Hypothesizer, Strategist, Diagnostician, Narrator) | ✅ Sim |
| `packages/ingestors` (inferência semântica) | ✅ Sim, em design time |

**Regra prática:** se o código roda dentro do orçamento de 5 minutos do Tier 1 e o resultado influencia o veredito, **não pode haver chamada de modelo ali**.

---

## 5. Convenções de código

### Geral

- **TypeScript strict**. `any` proibido; use `unknown` + narrowing.
- **Idioma:** código, identificadores, tipos e API em **inglês**. Documentação e mensagens ao usuário final em **pt-BR**.
- **Erros:** use os tipos canônicos de `packages/shared/errors`. Nunca `throw new Error("…")` genérico.
- **Logs:** estruturados, sempre com `runId`, `orgId`, `projectId`. Nunca logar segredo, PII ou payload bruto.
- **Datas:** UTC internamente, sempre. Conversão apenas na camada de apresentação.
- **Dinheiro:** nunca `float`. Use inteiro em menor unidade ou decimal de precisão fixa.

### Distinção crítica: erro de plataforma vs. falha de qualidade

```typescript
// RN-CI-005: falha de infraestrutura da plataforma NUNCA bloqueia o PR do cliente
throw new PlatformError("ENV_PROVISION_FAILED", { … });  // → não bloqueia
throw new QualityVerdict("REGRESSION_DETECTED", { … });  // → pode bloquear
```

Confundir os dois é um dos bugs mais danosos possíveis neste produto: destrói a confiança do time do cliente no gate.

### Toda saída de execução deve carregar

```typescript
interface RunMetadata {
  runId: string;
  worldModelVersion: string;
  irVersion: string;
  runnerVersion: string;
  browserVersion: string;
  seed: string;
  commit: string;
  baseRef: string;
  environment: string;
  confidenceMode: "ISOLATED" | "PARTITIONED" | "SHARED_DEGRADED";  // RN-EXE-007
  autonomyLevel: 1 | 2 | 3 | 4 | 5;
}
```

Sem isso, RN-EXE-001 e PA-12 são violados e o veredito é inválido.

---

## 6. Receitas de tarefas comuns

### 6.1 Adicionar uma nova capability de banco

1. Criar YAML em `capabilities/<domínio>/<nome>.yaml` (spec na Seção 14.3 da arquitetura)
2. Declarar obrigatoriamente: `operation`, `allowlist.tables`, `allowlist.columns`, `sensitivity`, `constraints`
3. Rodar `pnpm capabilities:validate` — executa parser AST, verificação de allowlist, `EXPLAIN` e checagem de índice
4. `READ` → PR normal. `WRITE`/`DESTRUCTIVE` → PR exige aprovação de dois revisores e só executa em ambiente descartável
5. **Nunca** marcar uma capability como `production`-elegível se ela não for `READ` (RN-DAT-006)

### 6.2 Adicionar um novo provedor de CI

1. Criar `shims/<provedor>/`
2. O shim faz **exatamente três coisas**: autenticar, invocar `aletheia run`, publicar resultado no formato nativo
3. Se você sentir vontade de adicionar um `if` de lógica de negócio → **pare**. Essa decisão pertence ao control plane (PA-11)
4. Meta: menos de 60 linhas de código efetivo

### 6.3 Adicionar um invariante

1. Definir em `packages/invariants/catalog/` com expressão **compilada e determinística** (RN-ORC-008)
2. Declarar: escopo, sinal de origem, severidade, custo de verificação
3. Nasce em estado `PROPOSED` (RN-ORC-003); nunca commitar já como `ACTIVE`
4. Deve executar em background sem afetar o orçamento da jornada

### 6.4 Adicionar uma regra de supressão no Diff Engine

Este é o componente de maior impacto na taxa de falso positivo. Cuidado extremo.

1. Toda regra de supressão precisa de **evidência**: pelo menos 3 casos reais rotulados como `NOISE`
2. Adicionar caso de regressão em `packages/diff-engine/__fixtures__/`
3. Medir impacto no corpus de referência **antes e depois** — nenhuma regra pode reduzir a detecção verdadeira
4. Supressão excessiva causa **falso negativo silencioso**, que é pior que falso positivo (PA-10)

### 6.5 Adicionar um conector

1. Implementar a interface `Connector` de `packages/connectors/`
2. Declarar `capabilities` explicitamente
3. Falha do conector **nunca** interrompe execução de teste (RN-INT-004) — retry exponencial e degradação graciosa
4. Credenciais sempre via `VaultRef`, nunca em configuração direta

---

## 7. Testes do próprio projeto

Ironia produtiva: uma plataforma de qualidade precisa de qualidade exemplar.

| Camada | Exigência |
|---|---|
| `diff-engine` | Corpus de referência versionado; toda mudança reporta delta de precisão e recall |
| `selector-engine` | Corpus de páginas reais com mutações conhecidas; medir taxa de resolução e de cura |
| `capabilities` | Validador testado contra suíte de SQL malicioso e mal-formado |
| `ir` | Migração entre versões de schema testada em ambas as direções |
| Runner | Testes determinísticos com seed fixo; zero tolerância a flake no próprio CI |
| Segurança | Teste que **falha o build** se qualquer PII ou segredo aparecer em evidência ou prompt |

**Nenhum teste do projeto usa `sleep`.** Aplicamos nossas próprias regras.

---

## 8. Fase atual e prioridades

> Atualize esta seção a cada transição de fase.

**Fase atual:** Fase 0 — Prova de vida do oráculo. **Critério de saída atingido em 2026-08-11** ([`docs/medicao-fase-0.md`](./docs/medicao-fase-0.md)): 5 defeitos distintos bloqueados de 9 presentes, 0% de falso positivo, e um PR real da mesma aplicação passou sem nenhum delta bloqueante.

**Escopo permitido agora:**
- Diff Engine (DOM, rede, visual)
- CLI mínima
- Relatório JSON e HTML

**Explicitamente fora de escopo nesta fase:** World Model, LLM em qualquer lugar, UI, capabilities de banco, shims além da CLI, integrações.

**Critério de saída:** detectar ≥ 5 regressões reais em aplicação real com < 10% de falso positivo, sem uma única linha de teste escrita.

**O segundo corpus existe desde 2026-08-13** (`packages/diff-engine/__corpus__/oscar/`, §10 da medição): django-oscar, Python/Django renderizado no servidor. 4 de 7 defeitos bloqueados, 0% de falso positivo no corpus de defeito, 7 de 7 visíveis.

**E ele derrubou uma das duas regras que fecharam a Fase 0** (§10.6). O corpus de mudança intencional do oscar — quatro mudanças reais e legítimas do projeto upstream — produziu **22 deltas bloqueantes, todos falso positivo**, todos vindos de **"nó com texto removido → HIGH"**: 20 pelo menu que passou a listar só categorias de primeiro nível, e 2 por uma reembalagem em que o texto nem desapareceu, só trocou de invólucro. A regra `href`/`action` → HIGH sobreviveu e saiu mais forte.

**Este é o item aberto mais importante do projeto agora.** Não conserte rebaixando a severidade de nó removido: é ela que pega `O6` e `F9`, item sumindo em silêncio de listagem, que é a regressão que passa por todo teste de fluxo. A §10.6 lista três direções; a primeira (separar remoção de reembalagem, no alinhamento) é a única sem trade-off aparente contra detecção, e é por onde começar. Qualquer mexida aqui reporta os números dos **quatro** corpora.

**Os dois corpora falham na mesma junta, e é aí que vale investir.** `F7` no `juventude` (atributo `required` perdido), `O3` e `O7` no `oscar` (`value` virando `None`, `alt` removido): sempre mudança de atributo com consequência comportamental que o motor não infere da mudança em si. Dois corpora independentes apontando para o mesmo lugar é evidência, não coincidência. O caminho é severidade por **consequência do atributo**, não por nome dele.

**Antes de considerar estável qualquer regra nova de severidade ou normalização**, rode o piso de ruído numa aplicação de stack estranha: duas capturas da mesma build, sem build nem login, dois minutos (comandos na §11 da medição). Zero delta bloqueante é o mínimo aceitável. Três aplicações desconhecidas, três achados de normalização — sempre identidade de sessão ou token, nunca severidade errada. O teste continua pagando.

**Toda mudança no `diff-engine` reporta delta de precisão e recall nos DOIS corpora de defeito** — `__corpus__/juventude/` e `__corpus__/oscar/` — e no de mudança intencional. Detectar mais é trivial se reprovar todo mundo for aceitável; o par de números é que diz alguma coisa.

> Se lhe pedirem para construir algo fora do escopo da fase atual, **sinalize antes de implementar**. O maior risco de execução deste projeto é escopo simultâneo (R-14).

---

## 9. Checklist antes de abrir PR

- [ ] Nenhuma chamada de LLM no caminho crítico de execução (PA-01)
- [ ] Nenhum SQL concatenado ou gerado dinamicamente (PA-04)
- [ ] Nenhum `sleep` / `waitForTimeout` / espera fixa (PA-07)
- [ ] Nenhuma rotina de cleanup adicionada (PA-06)
- [ ] Nenhum seletor único hardcoded (Seção 3.5)
- [ ] Nenhum `INSERT` direto para preparação de massa (RN-DAT-010)
- [ ] Nenhum valor de dado real enviado a modelo (PA-09)
- [ ] Nenhuma lógica de negócio em shim (PA-11)
- [ ] `PlatformError` e `QualityVerdict` corretamente distinguidos (RN-CI-005)
- [ ] Metadados completos de execução preenchidos (PA-12)
- [ ] Mudança em `diff-engine` acompanhada de delta medido de precisão/recall
- [ ] Regra de negócio nova ou alterada refletida em `docs/ARQUITETURA.md` §7
- [ ] Violação de princípio arquitetural justificada por ADR em `docs/adr/`

---

## 10. Como se comportar como assistente neste repositório

**Execute os pedidos você mesmo. Nunca dispare sub-agentes.** Quando eu pedir qualquer coisa — investigar, buscar, ler, planejar, implementar, revisar — faça no contexto principal da conversa, sozinho. Não delegue para sub-agentes (`Agent`/`Task`, `Explore`, `general-purpose`, `Plan`), não rode workflows multi-agente, não faça fan-out paralelo, não use deep research. Um único agente, uma única linha de raciocínio, do início ao fim. Vale mesmo quando a tarefa parecer grande ou paralelizável: se for grande demais para um contexto, reduza o escopo e me avise — não distribua.

**Empurre de volta quando o pedido violar a arquitetura.** Se alguém pedir "faça a IA gerar o SQL na hora", a resposta correta não é implementar — é apontar PA-04, explicar o risco concreto (`UPDATE` sem `WHERE` correto na milésima execução, estado válido-porém-inconsistente, PII no contexto, incidente de LGPD) e propor a alternativa via capability.

**Prefira reduzir escopo a expandir.** Este projeto morre por escopo simultâneo, não por falta de ambição. Quando houver dúvida entre construir mais ou construir melhor a cunha atual, escolha a cunha.

**Trate falso negativo como pior que falso positivo.** Suprimir ruído é tentador e destrói o produto silenciosamente. Toda supressão precisa de evidência.

**Não invente número.** Limiares, pesos e orçamentos deste documento são pontos de partida a calibrar com dados reais. Ao propor um valor novo, declare que é hipótese e como será validado.

**Quando o contexto for insuficiente, leia `docs/ARQUITETURA.md` antes de perguntar.** As respostas para a maioria das dúvidas de design já estão lá, com a justificativa.

---

## Referências rápidas

| Preciso de… | Onde |
|---|---|
| Regras de negócio numeradas | `docs/ARQUITETURA.md` §7 |
| Princípios invioláveis | `docs/ARQUITETURA.md` §4 |
| Schema da IR | `docs/ARQUITETURA.md` §12.1 |
| Spec de capability | `docs/ARQUITETURA.md` §14.3 |
| Hierarquia de massa de teste | `docs/ARQUITETURA.md` §14.5 |
| Estratégias de isolamento | `docs/ARQUITETURA.md` §14.6 |
| Tiers de execução de CI | `docs/ARQUITETURA.md` §15.3 |
| Escada de autonomia | `docs/ARQUITETURA.md` §16.1 |
| Decisões arquiteturais | `docs/ARQUITETURA.md` §23 e `docs/adr/` |
| Plano de fases | `docs/ARQUITETURA.md` §21 |
