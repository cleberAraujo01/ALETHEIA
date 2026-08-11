# ALETHEIA — Plataforma de Engenharia de Qualidade Autônoma

> **Documento de Arquitetura, Regras de Negócio e Plano de Atuação**
> Versão 1.0 · Documento vivo · Fonte da verdade do projeto

| Campo | Valor |
|---|---|
| **Codinome** | ALETHEIA (grego: *desvelamento, aquilo que deixa de estar oculto*) — placeholder, sujeito a naming comercial |
| **Categoria** | Autonomous Quality Engineering Platform (AQE) |
| **Status** | Concepção / Pré-Fase 0 |
| **Público** | Engenharia, Produto, Segurança, Investidores, Clientes-piloto |
| **Idioma** | pt-BR (documentação) · en-US (código, identificadores, API) |

---

## Índice

1. [Sumário Executivo](#1-sumário-executivo)
2. [O Problema Central: o Oráculo](#2-o-problema-central-o-oráculo)
3. [Teoria de Mudança e Proposta de Valor](#3-teoria-de-mudança-e-proposta-de-valor)
4. [Princípios Arquiteturais Invioláveis](#4-princípios-arquiteturais-invioláveis)
5. [Escopo e Não-Escopo](#5-escopo-e-não-escopo)
6. [Personas e Jornadas de Uso](#6-personas-e-jornadas-de-uso)
7. [Regras de Negócio](#7-regras-de-negócio)
8. [Arquitetura Macro](#8-arquitetura-macro)
9. [World Model — O Ativo Central](#9-world-model--o-ativo-central)
10. [Camada de Percepção](#10-camada-de-percepção)
11. [Camada Cognitiva](#11-camada-cognitiva)
12. [Camada Determinística](#12-camada-determinística)
13. [Framework de Oráculos](#13-framework-de-oráculos)
14. [Módulo de Dados](#14-módulo-de-dados)
15. [Módulo CI/CD](#15-módulo-cicd)
16. [Escada de Autonomia e Calibração](#16-escada-de-autonomia-e-calibração)
17. [Ecossistema de Integrações](#17-ecossistema-de-integrações)
18. [Segurança, Privacidade e Conformidade](#18-segurança-privacidade-e-conformidade)
19. [Stack Tecnológica e Topologia de Deploy](#19-stack-tecnológica-e-topologia-de-deploy)
20. [Métricas, KPIs e Observabilidade da Plataforma](#20-métricas-kpis-e-observabilidade-da-plataforma)
21. [Plano de Atuação](#21-plano-de-atuação)
22. [Registro de Riscos](#22-registro-de-riscos)
23. [Decisões Arquiteturais (ADRs)](#23-decisões-arquiteturais-adrs)
24. [Estratégia de Demonstração e Go-to-Market](#24-estratégia-de-demonstração-e-go-to-market)
25. [Glossário](#25-glossário)

---

## 1. Sumário Executivo

### 1.1 O que estamos construindo

Não estamos construindo mais uma ferramenta de automação de testes. Estamos construindo um **sistema que constrói e mantém um modelo vivo do software do cliente**, descobre as verdades que esse software precisa manter, e avisa no instante em que uma delas deixa de ser verdade.

A diferença é categórica:

| Ferramenta de automação | ALETHEIA |
|---|---|
| Humano descreve o teste | Plataforma descobre o que precisa ser verificado |
| Artefato central: script de teste | Artefato central: **World Model** (grafo semântico do sistema) |
| Cobertura cresce linearmente com esforço humano | Cobertura cresce multiplicativamente (invariantes × jornadas) |
| Manutenção é custo permanente | Manutenção é função autônoma auditada |
| Detecta o que alguém pensou em verificar | Detecta o que **mudou e não deveria ter mudado** |
| Requer conhecimento técnico para autorar | Requer apenas capacidade de **decidir**, não de construir |

### 1.2 Pitch de uma frase

> **"Nós não escrevemos testes. Construímos um modelo vivo do seu sistema, descobrimos as verdades que ele precisa manter, e avisamos no minuto em que uma delas deixa de ser verdade."**

### 1.3 A demonstração que define o produto

Abrir um Pull Request ao vivo, em uma aplicação que a plataforma nunca viu antes, sem nenhuma configuração prévia, e receber em menos de 5 minutos um comentário no PR dizendo:

> *"Este PR altera o cálculo de desconto em 3 jornadas de checkout que representam 22% da receita observada em produção. O campo `discountAmount` passou de 15,00 para 10,00 na jornada 'Checkout com cupom PIX'. A UI exibe R$ 85,00, a API retorna 85,00, mas `orders.total_amount` gravou 90,00 — há divergência entre camada de transporte e camada de persistência. Causa raiz provável: `PricingService.applyCoupon`, linha 142, alterada neste PR. Evidências: vídeo, trace, HAR, diff de banco."*

Nada disso foi escrito por um ser humano.

### 1.4 O ativo defensável

Em 2026, "agente de IA que testa sua aplicação" **não é diferencial** — é commodity que os modelos de fronteira absorvem a cada seis meses. O fosso competitivo desta plataforma é:

1. **O World Model** — grafo semântico persistente, versionado e acumulativo por cliente. Um concorrente copia um prompt em uma tarde; não copia dois anos de modelo acumulado.
2. **Os dados de calibração** — histórico de vereditos aceitos/rejeitados por categoria, que sustentam a escada de autonomia. Sem isso, ninguém confia na IA como gate de deploy.
3. **O motor determinístico de diferencial** — a capacidade de suprimir ruído com baixíssimo falso positivo é engenharia acumulada, não prompt.

---

## 2. O Problema Central: o Oráculo

### 2.1 Enunciado

Uma IA que explora autonomamente uma aplicação consegue descobrir, sem ajuda de ninguém:

- Erros de JavaScript, respostas HTTP 4xx/5xx, timeouts, telas quebradas
- Violações de acessibilidade, regressões visuais, degradação de performance
- Quebra de contrato de API, campos nulos inesperados, N+1 queries

O que ela **jamais** descobre por observação isolada:

> Que o desconto do cupom deveria ser 15% e não 10%.

A tela renderiza. A API devolve 200. O fluxo completa. E o cálculo está errado.

Isso é o **problema do oráculo**: o sistema não tem como saber o que *deveria* acontecer, apenas o que *acontece*. E aproximadamente 80% dos defeitos que escapam para produção são desta natureza — regra de negócio incorreta, não crash.

### 2.2 Consequência arquitetural

A pergunta que estrutura toda a plataforma **não é** "como a IA explora a aplicação". É:

> **De onde vem a verdade contra a qual a IA julga o comportamento observado?**

### 2.3 As seis fontes de oráculo

A plataforma ingere todas. Cada uma tem força e fraqueza distintas.

| # | Fonte | O que fornece | Confiabilidade | Fraqueza |
|---|---|---|---|---|
| **O1** | Requisitos (Jira, Confluence, Figma, PRD) | Intenção declarada | Alta | Ambígua, desatualizada, incompleta |
| **O2** | Código + diff de PR | Intenção implementada | Alta para *o que mudou* | Não distingue bug de feature |
| **O3** | Contratos (OpenAPI, GraphQL, Protobuf, JSON Schema) | Forma esperada | Alta, mas estrutural | Não valida semântica de valor |
| **O4** | Telemetria de produção (RUM, APM, logs) | O que é *normal* | Altíssima para distribuição | Normaliza bugs antigos |
| **O5** | Versão anterior da própria aplicação | Baseline comportamental | **A mais poderosa e a mais ignorada pelo mercado** | Não detecta bug pré-existente |
| **O6** | Camada de persistência (banco de dados) | O que **de fato** aconteceu | Máxima | Requer acesso e governança rigorosa |

> **Insight central do produto:** O mercado inteiro se concentra em O1 (BDD, requisitos) e O3 (contract testing). **O5 e O6 são quase inexplorados comercialmente e são os mais poderosos.** É aí que está o espaço em branco.

### 2.4 As três estratégias que dispensam oráculo humano

Estas técnicas produzem veredito **sem que ninguém tenha escrito a expectativa**. São o coração da inovação.

#### 2.4.1 Teste Diferencial (O5)

Executar a mesma jornada contra a build de referência (`base`) e a build candidata (`head`), em paralelo, com estado inicial idêntico e seed determinístico. Comparar semanticamente os dois universos resultantes:

- Diff de DOM normalizado (suprimindo IDs gerados, timestamps, ordem de classes)
- Diff de payloads de rede (JSON estrutural, tolerante a campos voláteis)
- Diff de sequência de chamadas (surgiu N+1 que não existia?)
- Diff visual perceptual por região
- Diff de spans de trace distribuído
- **Diff de linhas afetadas no banco de dados**

Todo delta é **hipótese de regressão**. O LLM entra apenas para **classificar e explicar** o delta — nunca para decidir.

#### 2.4.2 Teste Metamórfico

Em vez de declarar "qual é a saída correta", declara-se **relações que devem se manter entre execuções**:

| Relação metamórfica | Domínio |
|---|---|
| Adicionar item ao carrinho ⟹ total nunca diminui | E-commerce |
| Aplicar filtro ⟹ número de resultados nunca aumenta | Busca/listagem |
| Ordenar asc e desc ⟹ conjuntos idênticos, ordem invertida | Listagem |
| Criar → deletar → listar ⟹ estado igual ao inicial | CRUD |
| Mesma jornada com usuário A e B ⟹ nenhum dado de A visível para B | Multi-tenant |
| Executar operação duas vezes com mesma chave de idempotência ⟹ um único efeito | Pagamentos |

O LLM **propõe** as relações candidatas a partir do World Model. Um humano **aprova em segundos** com um clique. A execução é 100% determinística.

> **Este é o mecanismo que torna o não-técnico produtivo.** Um PO não sabe escrever teste, mas sabe responder *"o total pode diminuir quando eu adiciono um item?"*.

#### 2.4.3 Invariantes de Sistema

Regras globais verificadas continuamente em background durante **toda e qualquer execução**, independentemente do teste em curso:

- Nenhuma resposta de API vaza PII fora do escopo do token
- Nenhum request excede o orçamento de latência p95
- Nenhum erro não tratado no console
- Nenhuma requisição a domínio não autorizado
- IDOR: alterar ID na URL nunca retorna dado de outro tenant
- Nenhuma query N+1 acima do limiar
- Toda transação exibida como concluída na UI possui linha correspondente no banco

> **Propriedade matemática:** cada jornada explorada testa **todos** os invariantes gratuitamente. Cobertura cresce como `jornadas × invariantes`, não como `número de testes escritos`. Isto é qualitativamente diferente de "gerar mais casos de teste".

### 2.5 Reframe do produto

> A plataforma **não gera casos de teste**. Ela constrói e mantém um **sistema de crenças verificáveis sobre a aplicação** — invariantes, relações metamórficas e baselines comportamentais. A IA é o motor que **descobre, propõe, mantém e checa** essas crenças. Casos de teste passam a ser artefato derivado e descartável.

---

## 3. Teoria de Mudança e Proposta de Valor

### 3.1 O que muda para cada persona

| Persona | Hoje | Com ALETHEIA |
|---|---|---|
| **QA Engineer** | Escreve e mantém scripts em JS/Java/Python. 60% do tempo em manutenção. | Cura hipóteses, investiga vereditos, define política de risco. Vira **estrategista de qualidade**. |
| **Desenvolvedor** | Recebe bug vago dias depois do merge. | Recebe diff comportamental no PR, em minutos, com causa raiz apontada. |
| **Product Owner** | Não participa da qualidade. Confia ou não confia. | Responde perguntas de sim/não sobre regra de negócio. Consulta o sistema em linguagem natural. |
| **Gerente / Head** | Métricas de "testes executados" (vaidade). | Métricas de risco: defeitos escapados, cobertura de receita, MTTR. |
| **Analista de Negócio** | Escreve requisito, nunca sabe se foi validado. | Rastreia requisito → jornada → veredito automaticamente. |
| **Pessoa sem experiência técnica** | Impossível participar. | Modo Curadoria e Modo Interrogatório. Decide, não constrói. |

### 3.2 A tese de "acesso universal"

O erro previsível seria entregar um construtor visual de testes ao usuário não-técnico. Isso apenas troca código por caixinhas — a carga cognitiva permanece.

**A tese correta:** o usuário não-técnico não deve *construir* nada. Ele deve **decidir**. A plataforma faz as perguntas; o humano fornece o julgamento de negócio que nenhuma IA possui.

Ver [Seção 6.3 — Os Três Modos de Interação](#63-os-três-modos-de-interação).

---

## 4. Princípios Arquiteturais Invioláveis

Estes princípios têm força de lei no projeto. Qualquer PR que os viole deve ser rejeitado. Alterá-los exige um ADR formal.

### PA-01 — O LLM propõe, o código determinístico dispõe

> **Nenhum LLM no caminho crítico de execução de regressão.**

O LLM atua em: descoberta, proposição de hipóteses, priorização, diagnóstico, narração. **Nunca** em: emissão de veredito, seleção de elemento em runtime, execução de SQL, decisão de gate.

**Justificativa:** LLM no caminho crítico produz custo alto por execução, latência inaceitável em CI, resultados não reprodutíveis e um gate de deploy em que ninguém confia. Já matou produtos concorrentes.

### PA-02 — O World Model é a fonte da verdade

Nenhum componente mantém estado semântico próprio. Todo conhecimento sobre a aplicação vive no grafo, é versionado por commit e é diffável.

### PA-03 — Leitura antes de escrita, sempre

Todo o valor de oráculo do banco de dados vem de `SELECT`. Escrita serve apenas para preparação de massa e concentra todo o risco. Entrega-se o valor primeiro; o risco depois, com confiança já acumulada.

### PA-04 — A IA nunca recebe uma conexão

O LLM jamais emite SQL, comando de shell ou chamada de API mutante diretamente contra ambiente real. Toda operação passa por **capability compilada, parametrizada, analisada estaticamente e aprovada**.

### PA-05 — Determinismo em gate, criatividade fora dele

Exploração, geração de hipóteses e raciocínio livre acontecem em execuções assíncronas (Tier 3, noturno). Gates de PR e merge executam apenas artefatos compilados e determinísticos.

### PA-06 — Descartabilidade, não limpeza

Nunca escrever rotina de cleanup. Ambientes e bancos devem ser **descartáveis**. Compensação transacional é modo degradado explícito, jamais o padrão.

### PA-07 — Sleep é proibido

Nenhuma espera por tempo fixo em qualquer camada. Sincronização se dá por **convergência com deadline e sinais de progresso observáveis**. Qualquer `sleep` gerado deve ser marcado como dívida técnica visível no relatório.

### PA-08 — Cura nunca é silenciosa

Toda auto-correção (seletor, teste, dado) é registrada com diff antes/depois, evidência visual e entra em fila de aprovação humana até que a categoria seja promovida na escada de autonomia.

### PA-09 — Dado sensível não cruza fronteira

PII é mascarada **na borda do conector**, antes de qualquer persistência ou envio a modelo. Control plane e data plane são separados desde o dia 1.

### PA-10 — Honestidade sobre cobertura

A plataforma sempre expõe o que **não** foi validado e em que **modo de confiança** operou. Falso negativo silencioso é pior que falso positivo ruidoso.

### PA-11 — Um runner, muitos shims

Toda inteligência vive no control plane e em um runner único. Integrações de CI são adaptadores de ~50 linhas. Nunca duplicar lógica por provedor.

### PA-12 — Todo veredito é auditável e reproduzível

Dado um `runId`, é possível reconstituir integralmente: entrada, estado inicial, decisões tomadas, evidências e saída. Sem exceção.

---

## 5. Escopo e Não-Escopo

### 5.1 Em escopo

| Área | Detalhe |
|---|---|
| Aplicações Web | SPA e MPA, React/Angular/Vue/Svelte, SSR e CSR |
| APIs | REST, GraphQL, gRPC (via reflexão/proto) |
| Banco de dados | PostgreSQL, MySQL, SQL Server, Oracle, MongoDB, Redis |
| Mensageria | Kafka, RabbitMQ, SQS (observação e reconciliação de outbox) |
| Tipos de teste | E2E, funcional, API, contrato, integração, regressão, visual, acessibilidade, performance básica |
| CI/CD | GitHub Actions, GitLab CI, Azure Pipelines, Jenkins, Bitbucket Pipelines, CLI genérica |

### 5.2 Fora de escopo — declarado desde o dia 1

Declarar limites explicitamente é requisito de confiança. Prometer e falhar destrói o produto.

| Fora de escopo | Motivo | Reavaliação |
|---|---|---|
| Canvas / WebGL / jogos | Sem árvore semântica acessível | Fase 5+, via visão computacional |
| Shadow DOM fechado | Inacessível por design do navegador | Nunca (limitação da plataforma web) |
| iframes cross-origin sem cooperação | Restrição de segurança do navegador | Requer instrumentação cooperativa |
| Aplicações mobile nativas | Domínio distinto (Appium/XCUITest) | Fase 6+ |
| Desktop nativo | Fora da tese | Não planejado |
| Teste de carga em escala | Ferramenta especializada (k6, Gatling) | Integração, não substituição |
| Pentest / segurança ofensiva | Domínio regulado e distinto | Invariantes de segurança básicos apenas |
| Escrita em banco de **produção** | Risco inaceitável | **Nunca. Não configurável.** |

---

## 6. Personas e Jornadas de Uso

### 6.1 Matriz de personas

| Persona | Objetivo primário | Modo dominante | Nível de autonomia que aceita |
|---|---|---|---|
| QA Engineer | Confiança na suíte, fim da manutenção manual | Curadoria + Interrogatório | L3–L5 |
| Dev | Feedback rápido no PR | Consumo passivo (check no PR) | L4 |
| SDET / QA Architect | Governança, política de risco, extensões | Todos + escape hatch | L1–L5 |
| PO / BA | Garantir que a regra de negócio está correta | Curadoria | L2 |
| Gerente / Head de Qualidade | Risco e evidência para decisão de release | Interrogatório + Relatórios | L4–L5 |
| CISO / Compliance | Garantir que a plataforma não é um vetor de risco | Auditoria | — |

### 6.2 Jornadas críticas

**J1 — Onboarding de aplicação nova (target: < 30 minutos até o primeiro valor)**
1. Conectar repositório (GitHub/GitLab)
2. Informar URL de ambiente e credenciais de teste (via cofre)
3. Plataforma executa ingestão estática (código, OpenAPI, migrations, ORM)
4. Plataforma executa exploração autônoma inicial (Tier 3)
5. Entrega: mapa da aplicação, inventário de endpoints, jornadas descobertas, primeiras hipóteses propostas

**J2 — Gate de PR (target: < 5 minutos)**
1. PR aberto → webhook → seleção por risco a partir do diff
2. Provisionamento de ambiente efêmero + clone de banco
3. Execução diferencial `base` vs `head` das jornadas impactadas
4. Diff semântico multi-camada → vereditos determinísticos
5. LLM classifica, explica e prioriza os deltas
6. Comentário estruturado no PR + status check

**J3 — Curadoria matinal (target: < 10 minutos de atenção humana)**
1. Execução noturna produziu N hipóteses e M deltas não classificados
2. Fila apresentada em ordem de valor esperado
3. Humano responde sim/não/ajustar
4. Hipóteses aprovadas viram invariantes compilados, ativos a partir do próximo Tier 1

**J4 — Investigação de falha (target: MTTR reduzido em 70%)**
1. Falha reportada com RCA já sugerida
2. Timeline correlacionada: ação UI → request → span → query → linha alterada
3. Evidências: vídeo, trace, HAR, diff de banco, log
4. Ação: abrir bug no Jira com tudo anexado, em um clique

**J5 — Pergunta ao sistema (Modo Interrogatório)**
- *"O que quebra se eu mudar o campo `status` do pedido?"*
- *"Quais fluxos de pagamento nunca foram exercitados?"*
- *"Por que o teste de cupom falhou ontem à noite?"*
- *"Quais jornadas cobrem 80% da receita e qual delas está sem invariante ativo?"*

### 6.3 Os Três Modos de Interação

Nenhum deles é autoria de passos de teste.

#### Modo Intenção
Linguagem natural, alto nível. A IA já conhece a aplicação pelo World Model.

> *"Valide que o checkout com PIX funciona para clientes novos e recorrentes."*

Retorno: **evidência**, não script.

#### Modo Curadoria
A IA pergunta; o humano responde sim/não. É o PO fazendo Engenharia de Qualidade sem saber que está fazendo.

> *"Observei que o total do carrinho diminuiu ao adicionar um item de valor negativo. Isso é comportamento válido?"*

#### Modo Interrogatório
Perguntas sobre o sistema, respondidas pelo grafo. É o modo que faz gerente e PO abrirem a plataforma toda semana mesmo sem estar testando nada — transforma a ferramenta em **sistema de registro**.

---

## 7. Regras de Negócio

> **Convenção de identificação:** `RN-<DOMÍNIO>-<NNN>`. Toda regra é testável e rastreável. Regras marcadas com 🔒 são **invioláveis** e não podem ser desabilitadas por configuração de cliente.

### 7.1 Domínio: Organização e Tenancy (`RN-ORG`)

| ID | Regra | Criticidade |
|---|---|---|
| RN-ORG-001 | Toda entidade do sistema pertence obrigatoriamente a uma `Organization`. Não existe recurso órfão. | 🔒 |
| RN-ORG-002 | Isolamento entre organizações é garantido no nível de conexão de banco e de storage, não apenas por filtro de query. | 🔒 |
| RN-ORG-003 | Uma `Organization` contém N `Projects`; um `Project` representa uma aplicação sob teste (AUT) e possui exatamente um World Model versionado. | Alta |
| RN-ORG-004 | Um `Project` contém N `Environments` (dev, staging, prod, ephemeral-*), cada um com credenciais e política de segurança próprias. | Alta |
| RN-ORG-005 | Ambiente classificado como `production` recebe automaticamente perfil de segurança restritivo, sem possibilidade de override via UI. | 🔒 |
| RN-ORG-006 | Papéis mínimos: `Owner`, `Admin`, `QualityEngineer`, `Curator`, `Viewer`, `SecurityAuditor`. Permissões são aditivas e auditadas. | Alta |
| RN-ORG-007 | `SecurityAuditor` tem acesso somente-leitura irrestrito ao audit log e nenhum acesso a execução ou configuração. | Média |

### 7.2 Domínio: World Model (`RN-WM`)

| ID | Regra | Criticidade |
|---|---|---|
| RN-WM-001 | O World Model é imutável por versão. Toda alteração cria uma nova versão vinculada a um `commitSha`. | 🔒 |
| RN-WM-002 | Todo nó do grafo carrega `provenance`: qual ingestor o criou, quando, com qual confiança (0.0–1.0) e a partir de qual evidência. | 🔒 |
| RN-WM-003 | Nó com confiança inferior a 0.6 é marcado como `hypothesis` e nunca é usado para emitir veredito bloqueante. | Alta |
| RN-WM-004 | Nós não observados por N execuções consecutivas (default N=30) são marcados como `stale` e entram em fila de revalidação. | Média |
| RN-WM-005 | Conflito entre ingestores (ex.: OpenAPI declara `string`, tráfego observa `null`) nunca é resolvido silenciosamente: gera um `ContractDivergence` reportável. | Alta |
| RN-WM-006 | O grafo nunca armazena valores de dados reais — apenas forma, tipo, cardinalidade, distribuição e rótulo de sensibilidade. | 🔒 |
| RN-WM-007 | Duas versões do World Model devem ser diffáveis, produzindo um relatório de mudança estrutural da aplicação entre dois commits. | Alta |
| RN-WM-008 | Toda jornada minerada de produção é armazenada com frequência relativa e valor de negócio associado, quando disponível. | Alta |

### 7.3 Domínio: Oráculos e Hipóteses (`RN-ORC`)

| ID | Regra | Criticidade |
|---|---|---|
| RN-ORC-001 | Todo veredito deve declarar explicitamente qual oráculo (O1–O6) o fundamentou. Veredito sem oráculo identificado é inválido. | 🔒 |
| RN-ORC-002 | Nenhum veredito bloqueante pode ter como única fundamentação a saída de um LLM. | 🔒 |
| RN-ORC-003 | Toda hipótese proposta pela IA nasce no estado `PROPOSED` e requer aprovação humana para atingir `ACTIVE`. | 🔒 (até promoção L5 da categoria) |
| RN-ORC-004 | Estados válidos de hipótese: `PROPOSED` → `ACTIVE` \| `REJECTED` \| `DEFERRED`; `ACTIVE` → `SUSPENDED` \| `RETIRED`. Transições são auditadas. | Alta |
| RN-ORC-005 | Hipótese rejeitada não é reproposta pela IA por no mínimo 90 dias ou até que o World Model mude estruturalmente na região relacionada. | Alta |
| RN-ORC-006 | Invariante que falha mais de X% das execuções (default 20%) sem gerar bug confirmado é automaticamente suspenso e enviado para revisão. | Alta |
| RN-ORC-007 | Divergência entre camadas (UI, API, Banco) sobre o mesmo fato é sempre classificada como defeito, independentemente de haver expectativa declarada. | 🔒 |
| RN-ORC-008 | Relações metamórficas devem ser executáveis de forma determinística e sem dependência de LLM em runtime. | 🔒 |
| RN-ORC-009 | Todo delta detectado por teste diferencial recebe uma das classificações: `REGRESSION`, `INTENDED_CHANGE`, `NOISE`, `UNDETERMINED`. `UNDETERMINED` nunca bloqueia. | Alta |
| RN-ORC-010 | Delta classificado como `NOISE` alimenta automaticamente as regras de supressão do Diff Engine, com revisão humana. | Alta |

### 7.4 Domínio: Execução e Evidências (`RN-EXE`)

| ID | Regra | Criticidade |
|---|---|---|
| RN-EXE-001 | Toda execução possui `runId` único e imutável, e é integralmente reconstituível a partir dele. | 🔒 |
| RN-EXE-002 | Toda execução registra: versão do World Model, versão da IR, versão do runner, versão do browser, seed, ambiente e commit. | 🔒 |
| RN-EXE-003 | Evidências obrigatórias por execução: trace Playwright, vídeo, screenshots por passo, HAR, logs de console, spans OTel e diff de banco quando aplicável. | Alta |
| RN-EXE-004 | Evidências têm política de retenção configurável (default: 30 dias para sucesso, 180 dias para falha). | Média |
| RN-EXE-005 | Nenhuma espera por tempo fixo (`sleep`) é permitida. Sincronização usa convergência com deadline e sinais de progresso. | 🔒 |
| RN-EXE-006 | Falha de sincronização por deadline é reportada como `TIMEOUT_CONVERGENCE`, distinta de falha funcional. | Alta |
| RN-EXE-007 | Toda execução declara seu **modo de confiança**: `ISOLATED`, `PARTITIONED` ou `SHARED_DEGRADED`. O modo aparece em todo relatório. | 🔒 |
| RN-EXE-008 | Execução em modo `SHARED_DEGRADED` nunca pode operar em nível de autonomia L4 ou superior. | 🔒 |
| RN-EXE-009 | Falha classificada como flake não conta para o veredito, mas é sempre registrada e contabilizada no índice de instabilidade. | Alta |
| RN-EXE-010 | Retry automático é limitado a 2 tentativas e apenas para categorias de falha previamente classificadas como transientes. | Alta |
| RN-EXE-011 | Cura de seletor aplicada em runtime deve ser registrada com diff, screenshot e nível de confiança, e entrar em fila de aprovação. | 🔒 |
| RN-EXE-012 | O tempo de convergência é métrica de primeira classe: degradação significativa é reportada como regressão de performance. | Alta |

### 7.5 Domínio: Dados e Banco (`RN-DAT`)

| ID | Regra | Criticidade |
|---|---|---|
| RN-DAT-001 | Nenhum LLM emite SQL contra banco real em tempo de execução. Toda operação passa por capability compilada e aprovada. | 🔒 |
| RN-DAT-002 | Toda capability é parametrizada. Concatenação de string para montar SQL é proibida em qualquer camada. | 🔒 |
| RN-DAT-003 | Toda capability declara: operação (`READ`/`WRITE`/`DESTRUCTIVE`), allowlist de tabelas e colunas, timeout e limite de linhas. | 🔒 |
| RN-DAT-004 | Capability `READ` sem cláusula `LIMIT` explícita recebe `LIMIT` compulsório do sistema (default 1000). | Alta |
| RN-DAT-005 | Toda capability passa por `EXPLAIN` na validação; plano com custo acima do limiar é rejeitado na aprovação. | Alta |
| RN-DAT-006 | Ambiente `production` aceita exclusivamente capabilities `READ`, com usuário de banco somente-leitura. Não é configurável. | 🔒 |
| RN-DAT-007 | Capability `DESTRUCTIVE` só executa em ambiente marcado como descartável (`ephemeral` ou `isolated`). | 🔒 |
| RN-DAT-008 | Colunas classificadas como PII têm seus valores mascarados na borda do conector, antes de qualquer persistência ou envio a modelo. | 🔒 |
| RN-DAT-009 | Descoberta de schema opera sobre metadados e amostragem de forma; valores reais nunca entram no contexto do LLM. | 🔒 |
| RN-DAT-010 | Preparação de massa segue hierarquia obrigatória: **1) API da aplicação → 2) Factory de domínio → 3) Snapshot semeado → 4) SQL direto**. | 🔒 |
| RN-DAT-011 | Uso de SQL direto para preparação de massa é sempre marcado como dívida técnica e exibido no relatório de execução. | Alta |
| RN-DAT-012 | Valores de massa são derivados das distribuições observadas em produção, não de geração aleatória genérica. | Alta |
| RN-DAT-013 | Restauração de estado usa descartabilidade (clone/template/container). Compensação transacional é modo degradado explícito. | 🔒 |
| RN-DAT-014 | Reset é operação de **ecossistema**: banco, cache, fila, storage e webhooks. O World Model determina o escopo. | Alta |
| RN-DAT-015 | Toda execução de capability é registrada em audit log imutável: quem, o quê, quando, parâmetros mascarados, linhas afetadas e plano. | 🔒 |
| RN-DAT-016 | Consistência eventual é tratada por convergência com deadline; nunca por espera fixa. | 🔒 |
| RN-DAT-017 | Credenciais de banco vivem exclusivamente em cofre externo e nunca são persistidas no World Model ou em logs. | 🔒 |
| RN-DAT-018 | Existe kill switch por conexão e circuit breaker por taxa de erro, acionáveis sem deploy. | Alta |

### 7.6 Domínio: CI/CD (`RN-CI`)

| ID | Regra | Criticidade |
|---|---|---|
| RN-CI-001 | Toda integração de CI usa o mesmo runner e o mesmo contrato de execução. Lógica de negócio jamais reside no shim. | 🔒 |
| RN-CI-002 | O contrato mínimo de invocação exige: `commit`, `baseRef`, `environmentUrl`, `changeSet`, `dataStrategy`, `budget`, `autonomyLevel`. | Alta |
| RN-CI-003 | Execução Tier 1 (gate de PR) possui orçamento máximo de 5 minutos por padrão. Estouro de orçamento degrada escopo, não bloqueia o PR. | Alta |
| RN-CI-004 | Gate bloqueante só é aplicado a categorias de veredito promovidas a L4 na escada de autonomia. | 🔒 |
| RN-CI-005 | Falha de infraestrutura da plataforma nunca bloqueia o PR do cliente; é reportada como `PLATFORM_ERROR` e não como falha de qualidade. | 🔒 |
| RN-CI-006 | Todo resultado é publicado no formato nativo do provedor (check run, MR widget, work item) além do formato canônico interno. | Alta |
| RN-CI-007 | Seleção por risco é derivada do World Model; execução completa só ocorre em Tier 4 ou por solicitação explícita. | Alta |
| RN-CI-008 | Exploração autônoma e geração de hipóteses ocorrem exclusivamente em Tier 3 (assíncrono), nunca em gate. | 🔒 |
| RN-CI-009 | O orçamento de custo de tokens por execução é declarado, medido e exposto ao cliente. | Alta |

### 7.7 Domínio: Autonomia e Aprendizado (`RN-AUT`)

| ID | Regra | Criticidade |
|---|---|---|
| RN-AUT-001 | Autonomia é definida **por categoria de veredito**, nunca globalmente. | 🔒 |
| RN-AUT-002 | Promoção de nível exige atingir limiar de precisão calibrada em janela mínima de 90 dias e volume mínimo de amostras. | 🔒 |
| RN-AUT-003 | Rebaixamento é automático e imediato quando a precisão cai abaixo do limiar em janela móvel. | 🔒 |
| RN-AUT-004 | Todo veredito recebe feedback humano possível (`bug real` / `falso positivo` / `mudança intencional`), que alimenta a calibração. | Alta |
| RN-AUT-005 | Nível L5 (bloqueio de deploy com abertura automática de bug) exige aprovação explícita de `Owner` da organização. | 🔒 |
| RN-AUT-006 | A curva de aceitação de decisões autônomas é métrica pública ao cliente, por categoria. | Alta |
| RN-AUT-007 | Aprendizado ocorre por memória semântica, calibração, fingerprint de flake, política de exploração e ranking de cura — nunca por fine-tuning com dados de cliente sem consentimento contratual explícito. | 🔒 |
| RN-AUT-008 | Dados de um cliente nunca treinam modelo compartilhado entre clientes sem opt-in contratual. | 🔒 |

### 7.8 Domínio: Segurança e Conformidade (`RN-SEC`)

| ID | Regra | Criticidade |
|---|---|---|
| RN-SEC-001 | Separação control plane / data plane. Dado sensível não cruza a fronteira da VPC do cliente em modo self-hosted. | 🔒 |
| RN-SEC-002 | Provedor de modelo é abstraído; cliente pode exigir modelo em sua própria infraestrutura. | 🔒 |
| RN-SEC-003 | Agente autônomo opera sob allowlist de ações e domínios; ação fora da allowlist é bloqueada e registrada. | 🔒 |
| RN-SEC-004 | Existe kill switch global por organização, acionável sem deploy, que interrompe toda execução em andamento. | 🔒 |
| RN-SEC-005 | Audit log é imutável, append-only, com retenção mínima de 12 meses e exportável. | 🔒 |
| RN-SEC-006 | Nenhum segredo é registrado em log, evidência, prompt ou relatório. Redaction é aplicada em todas as saídas. | 🔒 |
| RN-SEC-007 | Toda evidência (vídeo, HAR, screenshot) passa por scrubbing de PII antes de persistir. | 🔒 |
| RN-SEC-008 | Exploração autônoma nunca opera com credencial de usuário real de produção. | 🔒 |

### 7.9 Domínio: Integrações (`RN-INT`)

| ID | Regra | Criticidade |
|---|---|---|
| RN-INT-001 | Toda integração implementa a mesma interface canônica de conector; especificidades ficam confinadas ao adaptador. | Alta |
| RN-INT-002 | Integrações são bidirecionais quando possível: ingestão de oráculo (entrada) e publicação de resultado (saída). | Alta |
| RN-INT-003 | Bug aberto automaticamente em ferramenta externa deve conter: RCA, evidências, passos mínimos de reprodução e link para o `runId`. | Alta |
| RN-INT-004 | Falha de integração externa jamais interrompe execução de teste; é registrada e reprocessada com retry exponencial. | Alta |
| RN-INT-005 | Abertura automática de bug requer nível L5 na categoria e configuração explícita por projeto. | 🔒 |

### 7.10 Domínio: Cobertura e Transparência (`RN-COB`)

| ID | Regra | Criticidade |
|---|---|---|
| RN-COB-001 | Todo relatório declara explicitamente o que **não** foi validado naquela execução. | 🔒 |
| RN-COB-002 | Cobertura é reportada em dimensões de negócio (jornadas, receita coberta, endpoints críticos), não apenas em cobertura de código. | Alta |
| RN-COB-003 | Regiões da aplicação nunca exercitadas são listadas ativamente como lacuna, não omitidas. | Alta |
| RN-COB-004 | Relatório executivo e relatório técnico derivam do mesmo conjunto de fatos; divergência entre eles é bug de produto. | Alta |

---

## 8. Arquitetura Macro

### 8.1 Visão em camadas

```
╔══════════════════════════════════════════════════════════════════════╗
║  CAMADA DE PERCEPÇÃO — como a plataforma "vê" o sistema              ║
╠══════════════════════════════════════════════════════════════════════╣
║  Static Ingestor    repositório, OpenAPI/GraphQL/Proto, migrations,  ║
║                     modelos ORM, IaC, feature flags, diff de PR      ║
║  Runtime Observer   CDP (DOM, AX tree, rede, console, performance),  ║
║                     OpenTelemetry (spans FE → BE → DB → fila)        ║
║  Production Miner   RUM, APM, logs → jornadas reais, distribuições,  ║
║                     hot paths, valor de negócio por fluxo            ║
║  Requirements       Jira, Confluence, Figma, PRDs, ADRs do cliente   ║
║  Schema Ingestor    information_schema, migrations, ORM, índices     ║
╚══════════════════════════════════════════════════════════════════════╝
                                   ↓
╔══════════════════════════════════════════════════════════════════════╗
║  WORLD MODEL — grafo semântico versionado  ◆ O ATIVO DEFENSÁVEL ◆    ║
║  Neo4j / PostgreSQL + pgvector · snapshot por commit · diffável      ║
║  Telas · Elementos · Endpoints · Entidades · Tabelas · Regras ·      ║
║  Serviços · Jornadas · Invariantes · Relações Metamórficas           ║
╚══════════════════════════════════════════════════════════════════════╝
                                   ↓
╔══════════════════════════════════════════════════════════════════════╗
║  CAMADA COGNITIVA — LLM opera AQUI, e somente aqui                   ║
╠══════════════════════════════════════════════════════════════════════╣
║  Explorer        política de exploração guiada por cobertura         ║
║  Hypothesizer    propõe invariantes e relações metamórficas          ║
║  Strategist      seleciona o que testar dado diff e risco            ║
║  DataAnalyst     propõe capabilities de banco e estratégia de massa  ║
║  Diagnostician   RCA a partir de evidência correlacionada            ║
║  Narrator        relatórios executivos e técnicos em linguagem natural║
╚══════════════════════════════════════════════════════════════════════╝
                                   ↓
╔══════════════════════════════════════════════════════════════════════╗
║  CAMADA DETERMINÍSTICA — LLM PROIBIDO (PA-01)                        ║
╠══════════════════════════════════════════════════════════════════════╣
║  IR Compilada · Runner Playwright · Motor de Seletores multi-sinal   ║
║  Diff Engine (DOM · rede · visual · trace · banco)                   ║
║  Verificador de Invariantes · Executor de Capabilities               ║
║  Service Virtualization · Gravação e replay de tráfego               ║
╚══════════════════════════════════════════════════════════════════════╝
                                   ↓
╔══════════════════════════════════════════════════════════════════════╗
║  CAMADA DE CONFIANÇA — governança e aprendizado                      ║
║  Escada de Autonomia · Fila de Curadoria · Motor de Calibração ·     ║
║  Quarentena de Flake · Audit Log · Política de Risco                 ║
╚══════════════════════════════════════════════════════════════════════╝
                                   ↓
╔══════════════════════════════════════════════════════════════════════╗
║  CAMADA DE APRESENTAÇÃO E INTEGRAÇÃO                                 ║
║  Web App (3 modos) · API pública · Shims de CI · Conectores          ║
╚══════════════════════════════════════════════════════════════════════╝
```

### 8.2 Topologia de deploy — dois planos

```
┌─────────────────── CONTROL PLANE (SaaS ou self-hosted) ───────────────────┐
│  Orquestração · Escada de autonomia · Calibração · Billing · Web App      │
│  Metadados, embeddings anonimizados, vereditos, métricas                  │
│  ⚠ NUNCA: dados de cliente, credenciais, PII, código-fonte                │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │ mTLS · API autenticada · outbound-only
┌──────────────────────────────┴───────────────────────────────────────────┐
│           DATA PLANE (dentro da VPC do cliente — sempre)                 │
│  Runner · Executor de Capabilities · Ingestores · Diff Engine            │
│  Gateway de Modelo (Bedrock/Vertex/Azure/local) · Cofre · Storage        │
│  Acesso a: repositório, banco, ambientes, telemetria                     │
└──────────────────────────────────────────────────────────────────────────┘
```

> **RN-SEC-001.** Esta separação é decidida no dia 1. Reformar depois custa aproximadamente um ano de trabalho; fazer agora custa semanas.

### 8.3 Fluxo de dados de uma execução Tier 1

```
Webhook PR
   │
   ├─→ [Strategist]  diff de código + World Model → conjunto de jornadas impactadas
   │
   ├─→ [Provisioner] ambiente efêmero + CREATE DATABASE ... TEMPLATE + mocks
   │
   ├─→ [Runner base]  executa jornadas contra build de referência ─┐
   ├─→ [Runner head]  executa jornadas contra build candidata    ──┤
   │                                                              │
   ├─→ [Diff Engine] ←────────────────────────────────────────────┘
   │      DOM · rede · visual · trace · BANCO → lista de deltas
   │
   ├─→ [Verificador de Invariantes] → violações determinísticas
   │
   ├─→ [Classificador] regras + LLM → REGRESSION | INTENDED | NOISE | UNDETERMINED
   │
   ├─→ [Diagnostician] correlação de evidências → RCA
   │
   ├─→ [Narrator] → comentário no PR + relatórios
   │
   └─→ [Calibração] registra veredito para feedback posterior
```

---

## 9. World Model — O Ativo Central

### 9.1 Por que um grafo

Relações de impacto são inerentemente transitivas: `PR → arquivo → classe → endpoint → tabela → jornada → receita`. Consultas de impacto em profundidade variável são naturais em grafo e caras em modelo relacional puro.

### 9.2 Tipos de nó

| Nó | Atributos principais | Origem |
|---|---|---|
| `Application` | nome, tipo, stack detectada | Static |
| `Screen` | fingerprint semântico, rota, título, tipo (lista/form/detalhe) | Runtime |
| `Element` | papel ARIA, nome acessível, intenção inferida, estabilidade histórica, sinais de seletor | Runtime |
| `Endpoint` | método, path template, contrato inferido, contrato declarado, latência p50/p95, taxa de erro, criticidade | Static + Runtime |
| `Service` | nome, linguagem, versão, owner | OTel + IaC |
| `DomainEntity` | nome de negócio, campos, mapeamento para tabelas | ORM + payloads |
| `Table` / `Collection` | schema, colunas, tipos, nullability, FKs, índices, rótulo de sensibilidade | Schema Ingestor |
| `Column` / `Field` | tipo, nullable, distribuição observada, classificação PII | Schema Ingestor |
| `BusinessRule` | enunciado, origem (requisito/código/observação), confiança | Requirements + LLM |
| `Journey` | sequência de passos, frequência em produção, valor de negócio, criticidade | Production Miner + Explorer |
| `Invariant` | tipo, escopo, expressão compilada, estado, precisão histórica | Hypothesizer + curadoria |
| `MetamorphicRelation` | relação, entradas, transformação, propriedade esperada, estado | Hypothesizer + curadoria |
| `Capability` | SQL/chamada compilada, operação, allowlist, aprovação | DataAnalyst + curadoria |
| `Queue` / `Topic` | nome, produtores, consumidores, formato de evento | OTel + Static |
| `Defect` | veredito, evidências, RCA, status externo | Execução |

### 9.3 Tipos de aresta

```
(Screen)      -[:DISPATCHES]->        (Endpoint)
(Endpoint)    -[:WRITES_TO]->         (Table)
(Endpoint)    -[:READS_FROM]->        (Table)
(Endpoint)    -[:PUBLISHES]->         (Topic)
(Endpoint)    -[:INVALIDATES]->       (CacheKey)
(Endpoint)    -[:IMPLEMENTED_BY]->    (Service)
(Journey)     -[:TRAVERSES]->         (Screen)
(Journey)     -[:EXERCISES]->         (Endpoint)
(BusinessRule)-[:GOVERNS]->           (Column | Endpoint | Journey)
(Invariant)   -[:APPLIES_TO]->        (Journey | Endpoint | Screen)
(Element)     -[:BELONGS_TO]->        (Screen)
(DomainEntity)-[:PERSISTED_IN]->      (Table)
(Table)       -[:REFERENCES]->        (Table)
(Commit)      -[:MODIFIES]->          (Service | Endpoint | Table)
(Defect)      -[:CAUSED_BY]->         (Commit | Service | Endpoint)
```

### 9.4 Consultas que só o grafo permite

```cypher
// Análise de impacto de um PR
MATCH (c:Commit {sha: $sha})-[:MODIFIES]->()<-[:IMPLEMENTED_BY|WRITES_TO*1..3]-(e:Endpoint)
MATCH (j:Journey)-[:EXERCISES]->(e)
RETURN j.name, j.productionFrequency, j.businessValue
ORDER BY j.businessValue DESC

// Lacuna de cobertura ponderada por receita
MATCH (j:Journey) WHERE NOT (j)<-[:APPLIES_TO]-(:Invariant {state:'ACTIVE'})
RETURN j.name, j.revenueShare ORDER BY j.revenueShare DESC

// Escopo de reset de ecossistema para uma jornada
MATCH (j:Journey {id:$id})-[:EXERCISES]->(e:Endpoint)
OPTIONAL MATCH (e)-[:WRITES_TO]->(t:Table)
OPTIONAL MATCH (e)-[:PUBLISHES]->(tp:Topic)
OPTIONAL MATCH (e)-[:INVALIDATES]->(k:CacheKey)
RETURN collect(DISTINCT t), collect(DISTINCT tp), collect(DISTINCT k)
```

### 9.5 Versionamento

- Snapshot por `commitSha`, armazenado de forma incremental
- Diff entre versões produz **relatório de mudança estrutural da aplicação**
- Toda execução referencia a versão exata do World Model utilizada (RN-EXE-002)

---

## 10. Camada de Percepção

### 10.1 Static Ingestor

| Fonte | Extrai | Nós/arestas gerados |
|---|---|---|
| Repositório | Estrutura, linguagens, frameworks, rotas | `Application`, `Service` |
| OpenAPI / GraphQL SDL / Protobuf | Contrato declarado | `Endpoint`, contrato |
| Migrations (Flyway, Liquibase, Prisma, Alembic, EF) | História e **intenção** do schema | `Table`, `Column`, evolução |
| Modelos ORM | Nomes de domínio que o schema físico esconde | `DomainEntity`, mapeamento |
| IaC (Terraform, Helm, Compose) | Topologia, dependências, ambientes | `Service`, dependências |
| Feature flags | Variantes de comportamento | Atributos de `Journey` |
| Diff de PR | Superfície de mudança | `Commit -[:MODIFIES]->` |

### 10.2 Runtime Observer

Baseado em **CDP para captura** e **Playwright para execução** (ADR-002).

Domínios CDP relevantes:

| Domínio | Uso |
|---|---|
| `Accessibility.getFullAXTree` | Papel + nome acessível — base dos seletores resilientes |
| `DOMSnapshot.captureSnapshot` | Contexto completo para fingerprint |
| `Network` | Quiescência, contrato observado, mock, HAR |
| `Overlay.setInspectMode` | Picker de elemento para curadoria |
| `Page` | Lifecycle, navegação, screenshot |
| `Runtime` | Avaliação no contexto da página, erros de console |
| `Performance` | Métricas de rendering |

Instrumentação OpenTelemetry propaga `traceId` da ação de UI até a query no banco — é o que torna RCA possível.

### 10.3 Production Miner

| Entrada | Produz |
|---|---|
| RUM / analytics | Jornadas reais e sua frequência |
| APM / traces | Latência real, hot paths, dependências |
| Logs | Padrões de erro conhecidos (baseline de normalidade) |
| Dados transacionais agregados | Valor de negócio por jornada, distribuição de valores |

> **Uso crítico:** geração de massa deriva das distribuições reais. O bug mora no CPF com dígito verificador atípico, no nome com apóstrofo, no valor com centavos de arredondamento — não em `"John Doe"`.

### 10.4 Requirements Ingestor

Jira, Confluence, Figma e PRDs alimentam `BusinessRule` com confiança moderada. Requisito é oráculo ambíguo — por isso RN-WM-003 impede que hipótese derivada só de requisito emita veredito bloqueante sem corroboração.

---

## 11. Camada Cognitiva

> Todo agente desta camada opera de forma **assíncrona e não bloqueante** (PA-05). Nenhum deles participa de gate.

### 11.1 Explorer

Política de exploração guiada por cobertura. Recompensa estados novos, penaliza repetição. Métrica de sucesso: cobertura de estados e rotas, **não** número de testes gerados.

Restrições: allowlist de ações e domínios (RN-SEC-003), jamais credencial real de produção (RN-SEC-008), sandbox com dados sintéticos.

### 11.2 Hypothesizer

Consome o World Model e propõe:
- Invariantes de sistema aplicáveis
- Relações metamórficas candidatas
- Asserções de reconciliação entre camadas

Saída sempre em estado `PROPOSED` (RN-ORC-003), com justificativa em linguagem natural e evidência observacional que a motivou.

### 11.3 Strategist

Dado um `changeSet` e o World Model, seleciona o conjunto mínimo de jornadas que cobre o risco introduzido. É o componente que defende o orçamento de 5 minutos do Tier 1.

Função de priorização:

```
risco(jornada) = w1 · proximidade_ao_diff
               + w2 · frequência_em_produção
               + w3 · valor_de_negócio
               + w4 · histórico_de_defeitos
               + w5 · recência_de_alteração
               - w6 · custo_de_execução
```

### 11.4 DataAnalyst

Propõe, em **design time**:
- Quais consultas validam determinada regra de negócio
- Qual estratégia de massa usar (respeitando a hierarquia RN-DAT-010)
- Quais capabilities criar
- Escopo de reset de ecossistema

Nunca executa. Produz artefatos que passam por compilação, análise estática e aprovação.

### 11.5 Diagnostician

Correlaciona evidências para produzir RCA:

```
Falha na tela X
  → span OTel identifica latência no serviço Y
    → query Z demorou 4.2s (plano sem índice)
      → serviço Y deployado há 40 min, commit abc123
        → commit alterou migration que removeu índice idx_orders_status
```

Isto é **correlação de grafo com evidência**, não inferência livre de LLM. O LLM apenas redige a explicação a partir da cadeia já estabelecida.

### 11.6 Narrator

Gera relatório executivo e relatório técnico a partir do mesmo conjunto de fatos (RN-COB-004). Formatos: HTML, Markdown, PDF, JSON canônico, JUnit XML.

### 11.7 Gateway de Modelo

Abstração obrigatória sobre provedores (Bedrock, Vertex, Azure OpenAI, Anthropic API, modelo local). Responsabilidades:
- Roteamento por tarefa e por política do cliente
- Orçamento e medição de custo por execução (RN-CI-009)
- Redaction de prompt antes do envio (RN-SEC-006)
- Cache semântico
- Fallback e degradação graciosa

---

## 12. Camada Determinística

### 12.1 IR — Representação Intermediária

Toda jornada é representada por uma estrutura declarativa versionada. **Código é projeção descartável da IR, nunca a fonte da verdade.**

```jsonc
{
  "schemaVersion": "1.0",
  "journey": {
    "id": "jr_checkout_pix",
    "name": "Checkout com PIX",
    "tags": ["smoke", "pagamento", "receita-alta"],
    "confidenceMode": "ISOLATED",
    "preconditions": [
      { "type": "dataFixture", "strategy": "API", "ref": "fx_user_with_cart" }
    ],
    "steps": [
      {
        "id": "st_01",
        "action": "click",
        "targetRef": "el_btn_finalizar",
        "waits": [{ "type": "networkIdle", "urlPattern": "/api/cart/**" }],
        "meta": { "screenshotRef": "…", "source": "explorer", "confidence": 0.94 }
      },
      {
        "id": "st_02",
        "action": "assert.reconcile",
        "layers": {
          "ui":  { "targetRef": "el_total", "extract": "currency" },
          "api": { "endpointRef": "ep_post_orders", "jsonPath": "$.total" },
          "db":  { "capabilityRef": "cap_order_total", "params": { "orderId": "{{ctx.orderId}}" } }
        },
        "tolerance": { "type": "decimal", "precision": 2 }
      }
    ],
    "teardown": [{ "type": "disposeEnvironment" }]
  }
}
```

**Por que IR é inegociável:** múltiplos backends, diffável e revisável em PR, refatoração global, migração de schema versionada, self-healing centralizado, upgrade instantâneo de toda a suíte.

**Interpretador, não codegen.** O runner interpreta a IR. `Eject` para código Playwright existe como escape hatch de mão única, para dar confiança ao time de desenvolvimento.

### 12.2 Motor de Seletores multi-sinal

Nunca grava um seletor. Grava um **fingerprint ponderado**:

```jsonc
{
  "id": "el_btn_finalizar",
  "signals": {
    "testId":      { "value": "checkout-submit", "weight": 1.00 },
    "ariaRole":    { "role": "button", "name": "Finalizar compra", "weight": 0.90 },
    "text":        { "normalized": "finalizar compra", "weight": 0.70 },
    "attributes":  { "tag": "button", "type": "submit", "weight": 0.40 },
    "anchor":      { "relation": "inside", "ref": "el_dialog_pagamento", "weight": 0.60 },
    "structural":  { "css": "div>form>button:nth-child(3)", "weight": 0.15 },
    "geometry":    { "box": [120, 640, 180, 44], "weight": 0.10 },
    "subtreeHash": { "value": "a3f9…", "weight": 0.25 }
  },
  "stabilityHistory": { "resolvedRuns": 412, "healedRuns": 3, "lastHealAt": "…" }
}
```

Pontos críticos:
- **Detector de ID gerado**: `mui-4821`, `:r1a:`, UUIDs, hashes de CSS-in-JS são classificados e rebaixados automaticamente. Sozinho, resolve grande parte das quebras.
- **Consenso ponderado** em runtime: todas as estratégias pontuam candidatos; escolha por consenso.
- **Cura nunca silenciosa** (PA-08 / RN-EXE-011).
- **Regras antes de ML.** Os desfechos de cura formam dataset rotulado; ranker treinado só após ~50k rótulos.

### 12.3 Repositório de Elementos

Fingerprints deduplicados em catálogo compartilhado por aplicação. É **Page Object Model gerado automaticamente**. Entrega de graça: correção em um lugar propaga para toda a suíte, análise de impacto por elemento, inventário navegável da aplicação.

### 12.4 Diff Engine — o componente que decide o produto

A taxa de falso positivo do produto é essencialmente a taxa de falso positivo deste componente.

**Pipeline:**

```
1. NORMALIZAÇÃO      remove ruído conhecido (IDs gerados, timestamps,
                     ordem de classes, nonces, tokens, seeds)
2. ALINHAMENTO       casa elementos/requests/linhas entre base e head
                     (não por índice — por identidade semântica)
3. DIFERENCIAÇÃO     produz deltas tipados por camada
4. SUPRESSÃO         aplica regras aprendidas de ruído (RN-ORC-010)
5. PONTUAÇÃO         severidade × proximidade ao diff × valor de negócio
6. CLASSIFICAÇÃO     REGRESSION | INTENDED_CHANGE | NOISE | UNDETERMINED
```

**Camadas de diff:**

| Camada | Técnica | Ruído típico a suprimir |
|---|---|---|
| DOM | Árvore normalizada + hash de subárvore | IDs gerados, ordem de classes, atributos de framework |
| Rede | JSON diff estrutural | timestamps, requestId, tokens, ordem de arrays não ordenados |
| Visual | Perceptual por região, com máscaras | antialiasing, fontes, animação, conteúdo dinâmico |
| Trace | Diff de sequência e duração de spans | jitter de latência, spans de infraestrutura |
| **Banco** | Diff de linhas afetadas por transação | `created_at`, sequences, IDs autoincrement |

### 12.5 Verificador de Invariantes

Executa em background durante **toda** execução, independentemente da jornada. Custo marginal próximo de zero; ganho de cobertura multiplicativo.

### 12.6 Service Virtualization

Deriva do tráfego gravado:
1. Contrato **observado** (≠ contrato declarado — o diff entre os dois já é relatório de valor)
2. Camada de replay determinístico para testar frontend isolado, offline, em segundos
3. **Caos de contrato** gerado automaticamente: campo nulo, lista vazia, 503, latência de 30s, ordem alterada. A maioria das aplicações quebra e ninguém testa.
4. Contract testing invertido: a plataforma sabe o que o front consome e detecta violação do backend antes do deploy.

### 12.7 Anti-flake

| Técnica | Efeito |
|---|---|
| Actionability do Playwright | Resolve ~80% dos casos |
| Contexto de rede por ação → wait por route pattern | Elimina espera cega |
| Quiescência de app (sem XHR pendente + sem mutação de DOM + sem animação) | Sincronização determinística |
| `storageState` + setup via API | Elimina replay de login por UI |
| Fingerprint de flake + quarentena automática | Preserva confiança da suíte |
| Seed determinístico e relógio controlado | Reprodutibilidade |

---

## 13. Framework de Oráculos

Consolidação operacional das estratégias descritas na Seção 2.

### 13.1 Matriz de decisão

| Situação | Oráculo aplicável | Determinístico? | Bloqueia gate? |
|---|---|---|---|
| Existe build de referência | O5 — Diferencial | Sim | Sim (L4) |
| Existe relação lógica declarável | Metamórfico | Sim | Sim (L4) |
| Regra global do sistema | Invariante | Sim | Sim (L4) |
| Existe contrato declarado | O3 — Contrato | Sim | Sim (L4) |
| Fato observável em 3 camadas | O6 — Reconciliação | Sim | Sim (L4) |
| Existe requisito escrito | O1 — Intenção | Não (ambíguo) | Não (L2) |
| Apenas comportamento observado | Baseline de produção | Parcial | Não (L2/L3) |

### 13.2 Reconciliação de três camadas — o oráculo gratuito

Uma jornada produz três representações do mesmo fato:

| Camada | Fonte | Exemplo |
|---|---|---|
| Apresentação | DOM renderizado | `Total: R$ 85,00` |
| Transporte | Payload da API | `{ "total": 85.00, "discount": 15.00 }` |
| Persistência | Linhas afetadas | `orders.total_amount = 90.00` ⚠ |

**Divergência entre camadas é defeito, sem expectativa declarada por ninguém** (RN-ORC-007).

Padrões capturados que testes E2E tradicionais não capturam:

- UI exibe sucesso, transação não commitou (rollback silencioso)
- API retorna 200, registro entrou com campo obrigatório nulo
- Valor arredondado na exibição, gravado com precisão diferente
- Soft delete sumiu da UI, permanece visível para outro tenant
- Inconsistência entre tabela principal e tabela de auditoria/evento
- Cache Redis divergindo da fonte da verdade após invalidação falha
- Outbox: evento publicado sem linha correspondente, ou vice-versa

### 13.3 Catálogo inicial de invariantes

| Categoria | Invariante | Sinal |
|---|---|---|
| Segurança | Nenhuma resposta vaza campo PII fora do escopo do token | Rede + classificação de coluna |
| Segurança | Alterar ID em rota nunca retorna dado de outro tenant (IDOR) | Rede + banco |
| Segurança | Nenhuma requisição a domínio fora da allowlist | CDP Network |
| Integridade | Toda transação exibida como concluída possui linha no banco | UI + banco |
| Integridade | Toda linha criada em tabela transacional gera registro de auditoria | Banco |
| Integridade | Outbox reconciliado: evento ⟺ linha | Fila + banco |
| Performance | Nenhum request excede orçamento p95 declarado | OTel |
| Performance | Nenhuma jornada executa mais de N queries (detecção de N+1) | OTel + banco |
| Performance | Tempo de convergência dentro do baseline | Runner |
| Qualidade | Nenhum erro não tratado no console | CDP Runtime |
| Qualidade | Nenhuma violação WCAG de severidade crítica | AX Tree |
| Contrato | Payload observado conforma ao contrato declarado | Rede + OpenAPI |

---

## 14. Módulo de Dados

### 14.1 Posicionamento

O banco de dados **não é uma integração no menu**. É a **sexta fonte de oráculo** (O6) e a mais confiável de todas, porque é a única que revela o que de fato aconteceu. É também o componente de maior risco da plataforma — o único ponto onde uma IA autônoma tem acesso de escrita a estado persistente.

### 14.2 Arquitetura de Capabilities

> **RN-DAT-001.** Separação absoluta entre descoberta (design time, LLM participa) e execução (runtime, LLM ausente).

```
── DESIGN TIME ─────────────────────────────────────────────
   IA lê schema + código + ORM + migrations do World Model
        ↓
   IA propõe: "para validar 'cupom aplicado', consultar
               orders.discount_amount WHERE id = :orderId"
        ↓
   COMPILAÇÃO  → SQL parametrizado
   ANÁLISE     → parser AST, allowlist, EXPLAIN, custo, sensibilidade
   APROVAÇÃO   → revisão humana em PR (capability vive em Git)
        ↓
   Capability versionada e assinada
── RUNTIME ─────────────────────────────────────────────────
   Runner invoca: capability("order.getDiscount", { orderId })
   Executor: conexão de privilégio mínimo, timeout, LIMIT, audit
```

### 14.3 Especificação de Capability

```yaml
id: cap_order_discount
version: 3
name: order.getDiscount
description: Retorna o valor de desconto aplicado a um pedido
operation: READ                    # READ | WRITE | DESTRUCTIVE
engine: postgresql
allowedEnvironments: [ephemeral, staging, production]

sql: |
  SELECT discount_amount, total_amount, coupon_code
  FROM orders
  WHERE id = :orderId

parameters:
  orderId: { type: uuid, required: true }

allowlist:
  tables:  [orders]
  columns: [orders.id, orders.discount_amount, orders.total_amount, orders.coupon_code]

sensitivity:
  orders.coupon_code: LOW
  orders.total_amount: FINANCIAL

constraints:
  timeoutMs: 3000
  maxRows: 1
  explainMaxCost: 500
  requiresIndex: true

approval:
  status: APPROVED
  approvedBy: "…"
  approvedAt: "…"
  reviewPr: "…"

provenance:
  proposedBy: DataAnalyst
  evidence: ["run_8f2a…", "endpoint:POST /api/orders"]
```

**Validações estáticas obrigatórias na aprovação:**

1. Parser AST — nenhuma concatenação, nenhum SQL dinâmico
2. Tabelas e colunas referenciadas ∈ allowlist declarada
3. Operação declarada corresponde ao comando real
4. `EXPLAIN` executado; custo abaixo do limiar; índice presente quando exigido
5. `WRITE`/`DESTRUCTIVE` bloqueadas em ambiente não descartável (RN-DAT-007)
6. Colunas PII exigem política de mascaramento declarada
7. `LIMIT` compulsório aplicado quando ausente (RN-DAT-004)

### 14.4 Suporte por engine

| Engine | Descoberta de schema | Isolamento preferencial | Observações |
|---|---|---|---|
| PostgreSQL | `information_schema` + `pg_catalog` | `CREATE DATABASE … TEMPLATE` | Padrão-ouro (1–3s) |
| MySQL / MariaDB | `information_schema` | Snapshot de volume / container | Sem template nativo |
| SQL Server | `sys.*` | Snapshot de banco / restore | `DBCC` para snapshot rápido |
| Oracle | `ALL_TAB_COLUMNS` | Flashback / PDB clone | Governança corporativa pesada |
| MongoDB | Amostragem de forma de documento | Clone de database / namespace | Sem schema declarado |
| Redis | Inspeção de keyspace por padrão | `SELECT` de database numerado / flush isolado | Tratado como cache, não fonte da verdade |
| Kafka / filas | Metadados de tópico + consumer group | Namespace/prefixo por execução | Reconciliação de outbox |

### 14.5 Preparação de massa — hierarquia obrigatória

> **RN-DAT-010.** Esta ordem não é sugestão. `INSERT` direto bypassa validações, defaults calculados, eventos de domínio, triggers e projeções — cria registros que o sistema jamais criaria. O teste falha, o QA investiga por horas, conclui "a massa estava errada". Três episódios destes e ninguém confia mais na plataforma.

| Prioridade | Estratégia | Quando | Custo | Risco de estado inválido |
|---|---|---|---|---|
| **1** | **API da própria aplicação** | Sempre que existir endpoint | Médio | Nenhum |
| **2** | **Factory derivada do domínio** | ORM + FKs, resolução topológica | Baixo | Baixo |
| **3** | **Snapshot semeado** | Dataset canônico versionado | Muito baixo | Nenhum |
| **4** | **SQL direto** | Estados impossíveis via API (legado, corrupção, edge histórico) | Baixo | **Alto** |

A IA deve **descobrir sozinha** a estratégia 1: o grafo já sabe qual endpoint cria um `Pedido`, porque observou isso durante exploração. *"Preciso de um pedido pago"* vira sequência de chamadas de API, não `INSERT`.

Uso da estratégia 4 é sempre marcado como dívida técnica visível no relatório (RN-DAT-011).

### 14.6 Isolamento e restauração

> **PA-06 — Descartabilidade, não limpeza.** Cleanup falha quando o teste falha no meio, deixa resíduo acumulado, não cobre efeitos colaterais e acopla testes paralelos.

| Nível | Mecanismo | Custo | Isolamento | Aplicabilidade |
|---|---|---|---|---|
| 1 | Transação com rollback | ~0ms | Total | Só integração backend in-process. **Não funciona em E2E** |
| 2 | Particionamento por tenant/namespace | Baixo | Lógico | Excelente quando multi-tenant é nativo |
| 3 | `CREATE DATABASE … TEMPLATE` | 1–3s | Total | **Padrão para E2E em PostgreSQL** |
| 4 | Snapshot copy-on-write (ZFS/LVM/EBS) | segundos | Total | Bancos grandes, Oracle, SQL Server |
| 5 | Container efêmero + seed | 10–60s | Total | Testcontainers, ambientes por PR |

**Sinergia importante:** o mesmo mecanismo que dá isolamento de banco dá os **ambientes efêmeros por PR** de que o módulo de CI depende. Um investimento, dois problemas resolvidos.

**Modo degradado — compensação transacional.** Quando o cliente possui banco corporativo compartilhado que não pode ser clonado (realidade comum em Oracle e SQL Server corporativos): toda capability `WRITE` registra sua inversa, o runner mantém log de undo e desfaz em ordem reversa. É frágil por natureza. Deve ser projetado desde o início, com aviso explícito na UI de que o isolamento é parcial e com o modo de confiança marcado como `SHARED_DEGRADED` (RN-EXE-007), impedindo autonomia L4+ (RN-EXE-008).

**Reset é operação de ecossistema** (RN-DAT-014): restaurar o PostgreSQL não restaura Redis, Kafka, S3 nem o webhook que já disparou para o parceiro. O World Model determina o escopo completo.

### 14.7 Consistência eventual — a armadilha que gera ~40% dos flakes

O usuário clica em "Finalizar". A UI mostra sucesso. A consulta imediata ao banco não encontra a linha.

Isso não é bug — é CQRS, réplica de leitura com lag, worker assíncrono, outbox pattern, projeção de evento. Assumir leitura síncrona produz enxurrada de falsos positivos.

```
aguardarConvergencia({
  capability: "order.exists",
  params: { correlationId },
  deadline: "15s",
  backoff: "exponential",
  sinaisDeProgresso: [
    { tipo: "otelSpan",     nome: "OrderProjection.handle", estado: "ended" },
    { tipo: "consumerLag",  topico: "order.created", condicao: "advanced" },
    { tipo: "cacheKey",     chave: "cart:{userId}", condicao: "invalidated" }
  ]
})
```

**Efeito colateral valioso:** o tempo de convergência é métrica de primeira classe (RN-EXE-012). Projeção que levava 200ms passando a levar 4s é regressão de performance detectada gratuitamente, sem ninguém ter escrito teste de performance.

### 14.8 Segurança do módulo de dados

| Controle | Implementação |
|---|---|
| Credenciais | Cofre externo (Vault, KMS, secret de CI), rotacionáveis, nunca no World Model |
| Privilégio | Usuário de banco dedicado, `GRANT` mínimo por capability e ambiente |
| Produção | Somente-leitura, sempre, sem configuração de override (RN-DAT-006) |
| PII | Mascaramento na borda do conector, antes de persistência e prompt |
| Descoberta | Forma e cardinalidade, nunca valores (RN-DAT-009) |
| Auditoria | Log imutável: quem, o quê, quando, capability, linhas, plano |
| Aprovação | `DESTRUCTIVE` exige revisão humana e ambiente descartável |
| Contenção | Kill switch e circuit breaker por conexão |
| Residência | Data plane dentro da VPC do cliente |

---

## 15. Módulo CI/CD

### 15.1 Arquitetura: um runner, muitos shims

> **PA-11.** Tratar cinco provedores de CI como cinco integrações produz cinco bases de código, cinco superfícies de bug e cinco backlogs.

```
┌───────────────────────────────────────────────────────────┐
│  CONTROL PLANE                                            │
│  World Model · orquestração · seleção por risco ·         │
│  calibração · relatórios · gates                          │
└───────────────────────────────────────────────────────────┘
                        ↕ API autenticada (mTLS)
┌───────────────────────────────────────────────────────────┐
│  RUNNER — binário/container único                         │
│  aletheia run --commit=<sha> --base=<sha> --env=<url>     │
│  Playwright · CDP · OTel · Capabilities · Diff Engine     │
└───────────────────────────────────────────────────────────┘
                        ↑ invocado por
┌───────────────────────────────────────────────────────────┐
│  SHIMS — ~50 linhas cada, zero lógica de negócio          │
│  GitHub Action · GitLab template · Jenkins plugin ·       │
│  Azure task · Bitbucket pipe · CLI genérica               │
└───────────────────────────────────────────────────────────┘
```

O shim faz exatamente três coisas: autenticar, invocar o runner, publicar o resultado no formato nativo. Adicionar novo provedor passa a ser trabalho de um dia.

> **Construa a CLI genérica primeiro.** Ela é o produto real; os shims são conveniência. É ela que atende o cliente com CI que você nunca ouviu falar.

### 15.2 Contrato de execução

**Entrada (RN-CI-002):**

| Parâmetro | Uso |
|---|---|
| `commit` | Versão sob teste |
| `baseRef` | Habilita diff comportamental e análise de impacto |
| `environmentUrl` | Alvo (tipicamente ambiente efêmero do PR) |
| `changeSet` | Arquivos alterados → seleção por risco |
| `dataStrategy` | `template-clone` \| `ephemeral-container` \| `partition` \| `shared-degraded` |
| `budget` | Tempo máximo, custo máximo de tokens, paralelismo |
| `autonomyLevel` | Nível da escada aplicável a este gate |

**Saída:** veredito canônico, evidências, RCA, status check estruturado, JUnit XML, SARIF (para categorias de segurança).

### 15.3 Tiers de execução

| Tier | Gatilho | Orçamento | Escopo | Autonomia |
|---|---|---|---|---|
| **T0 — Pré-commit** | Hook local | < 30s | Contrato + invariantes estáticos | L4 (bloqueia) |
| **T1 — Gate de PR** | Abrir/atualizar PR | **< 5 min** | Jornadas impactadas + diff comportamental vs. base | L4 nas categorias calibradas |
| **T2 — Merge** | Push na branch principal | < 20 min | Regressão de caminhos críticos, integração, contrato entre serviços | L4 |
| **T3 — Noturno** | Agendado | Horas | Exploração autônoma, geração de hipóteses, mutação, caos de contrato | L2 (propõe, não bloqueia) |
| **T4 — Pré-release** | Tag / release | Sem limite | Suíte completa, carga, dados de produção mascarados | L5 |

**O T1 é o produto.** Cinco minutos é o limite psicológico do desenvolvedor. Acima disso, o time desabilita o gate — e o cliente é perdido sem cancelar contrato. Todo o trabalho de seleção por risco, sharding e service virtualization existe para defender esse número.

**O T3 é onde a IA pensa.** Exploração e geração de hipóteses são caras e não-determinísticas; não têm lugar em gate. À noite o agente explora sem pressa; de manhã o PO encontra uma fila de curadoria com perguntas de sim/não. O ritmo natural da plataforma é **noite criativa, dia determinístico**.

### 15.4 Ambientes efêmeros — pré-requisito escondido

Nada funciona bem se todos os PRs apontam para um único ambiente de homologação compartilhado: os testes interferem entre si e o flake torna-se estrutural.

**Modelo alvo:** cada PR provisiona aplicação + banco clonado + dependências virtualizadas, executa, e destrói.

**Realidade dos clientes:** três modos suportados, com honestidade explícita (RN-EXE-007):

| Modo | Isolamento | Autonomia máxima |
|---|---|---|
| `ISOLATED` (efêmero) | Total | L5 |
| `PARTITIONED` (compartilhado com particionamento) | Lógico | L4 |
| `SHARED_DEGRADED` (compartilhado sem isolamento) | Nenhum | **L3** |

### 15.5 Publicação de resultado por provedor

| Provedor | Superfície nativa |
|---|---|
| GitHub Actions | Check Run + comentário no PR + annotations + SARIF |
| GitLab CI | MR Widget + Code Quality report + JUnit |
| Azure Pipelines | Test Run + Work Item + PR status |
| Jenkins | JUnit publisher + build status + plugin de relatório |
| Bitbucket Pipelines | Build Status API + Code Insights |
| CLI genérica | JSON canônico + JUnit XML + exit code |

---

## 16. Escada de Autonomia e Calibração

### 16.1 A escada

> **RN-AUT-001.** Autonomia é definida por **categoria de veredito**, nunca globalmente. "Regressão visual está em L4 porque tem 0,3% de falso positivo nos últimos 90 dias; regra de negócio segue em L2."

| Nível | Comportamento | Ganho de confiança |
|---|---|---|
| **L1 — Observa** | Explora e reporta; não afirma nada | "não quebra nada" |
| **L2 — Propõe** | Sugere invariantes e testes; humano aprova em lote | Curadoria barata |
| **L3 — Mantém** | Auto-corrige seletores e testes quebrados, com diff auditável | Elimina a dor #1 do QA |
| **L4 — Julga** | Vira gate de CI para categorias calibradas | Confiança em produção |
| **L5 — Governa** | Bloqueia deploy, abre bug com RCA, propõe correção | Autonomia real |

Esta escada é a resposta à objeção que **todo** CTO fará: *"e se a IA errar?"*

### 16.2 Critérios de promoção

| Requisito | Limiar padrão |
|---|---|
| Janela de observação | ≥ 90 dias |
| Volume mínimo de vereditos na categoria | ≥ 200 |
| Precisão (bug real / total de alertas) | ≥ 95% para L4; ≥ 98% para L5 |
| Taxa de falso positivo | ≤ 5% para L4; ≤ 2% para L5 |
| Modo de confiança da execução | `ISOLATED` ou `PARTITIONED` |
| Aprovação | `Admin` para L4; **`Owner` para L5** (RN-AUT-005) |

Rebaixamento é **automático e imediato** ao cruzar o limiar para baixo em janela móvel (RN-AUT-003).

### 16.3 Os cinco loops de aprendizado

> "Aprendizado contínuo" é a frase mais fácil de dizer e mais difícil de sustentar em demonstração. Fine-tuning **não** é o mecanismo principal.

| Loop | Mecanismo | Métrica |
|---|---|---|
| **1. Memória semântica** | World Model cresce; RAG recupera contexto a cada decisão | Densidade e cobertura do grafo |
| **2. Calibração de oráculo** | Feedback por veredito (bug real / falso positivo / mudança intencional) | Precisão por categoria |
| **3. Fingerprint de flake** | Agrupamento por assinatura, índice de instabilidade, quarentena | Taxa de flake |
| **4. Exploração guiada** | Recompensa estados novos, penaliza repetição | Cobertura de estados/rotas |
| **5. Ranking de cura** | Cada cura aprovada/rejeitada é rótulo; heurística → ranker treinado (~50k rótulos) | Taxa de cura aceita |

**Métrica pública ao cliente (RN-AUT-006):** *"% de decisões autônomas aceitas por humanos, ao longo do tempo, por categoria."* Subir essa curva é o gráfico que se mostra no palco.

---

## 17. Ecossistema de Integrações

### 17.1 Princípio: fechar o ciclo, não listar logos

O valor não está em "temos integração com Jira". Está em **fechar o ciclo** entre oráculo de entrada e ação de saída.

| Direção | Fonte/Destino | Papel |
|---|---|---|
| **Entrada** | Jira, Azure Boards, ClickUp | Oráculo de intenção (O1) |
| **Entrada** | GitHub, GitLab, Bitbucket | Código, diff, análise de impacto (O2) |
| **Entrada** | Confluence, Figma | Requisito e design de referência |
| **Entrada** | Datadog, New Relic, Grafana, Sentry | Telemetria de produção (O4) |
| **Saída** | Jira, Azure DevOps, ClickUp | Bug com RCA, evidência e reprodução |
| **Saída** | Xray, Zephyr, TestRail | Rastreabilidade requisito ↔ execução |
| **Saída** | GitHub/GitLab/Bitbucket | Check, comentário, status, SARIF |
| **Saída** | Slack, Teams | Notificação e fila de curadoria |
| **Bidirecional** | Jenkins, GH Actions, GitLab CI, Azure Pipelines | Orquestração |

### 17.2 Interface canônica de conector

```typescript
interface Connector {
  readonly id: string;
  readonly capabilities: ConnectorCapability[];  // INGEST_REQUIREMENTS | PUBLISH_DEFECT | …
  authenticate(credentials: VaultRef): Promise<AuthContext>;
  healthCheck(): Promise<HealthStatus>;
  ingest?(scope: IngestScope): AsyncIterable<CanonicalFact>;
  publish?(artifact: CanonicalArtifact): Promise<ExternalRef>;
  // Falha jamais interrompe execução de teste (RN-INT-004)
}
```

### 17.3 Sequência de construção

**Ordem de prioridade:** GitHub + Jira + Slack primeiro. As demais são adaptadores sobre a interface canônica, construídos sob demanda de cliente.

> Construir catorze integrações antes de ter o motor funcionando é o erro clássico que consome um ano.

---

## 18. Segurança, Privacidade e Conformidade

### 18.1 Modelo de ameaças

| Ameaça | Vetor | Controle |
|---|---|---|
| Agente autônomo destrói dados | Escrita em ambiente errado | RN-DAT-006/007, sandbox, allowlist, kill switch |
| Vazamento de PII para modelo | Payload/banco no prompt | Mascaramento na borda (RN-DAT-008, RN-SEC-007) |
| Vazamento de segredo em evidência | HAR, vídeo, log | Redaction em todas as saídas (RN-SEC-006) |
| Prompt injection via conteúdo da aplicação | Texto malicioso em página sob teste | Conteúdo tratado como dado, nunca como instrução; agente sem ferramentas destrutivas |
| Escalação via capability | Capability aprovada com escopo amplo | Análise estática, allowlist, revisão em PR |
| Exfiltração via conector | Conector malicioso ou comprometido | Allowlist de domínios, mTLS, escopo mínimo de token |
| Comprometimento do control plane | SaaS multi-tenant | Data plane no cliente; control plane sem dado sensível |

### 18.2 Conformidade

| Norma | Implicação de projeto |
|---|---|
| **LGPD / GDPR** | Mascaramento na borda; minimização; direito de exclusão; DPA; residência de dados |
| **SOC 2 Tipo II** | Audit log imutável, controle de acesso, gestão de mudança, monitoramento |
| **ISO 27001** | Gestão de risco documentada, política de segurança, continuidade |
| **PCI-DSS** (clientes de pagamento) | Nunca tocar em PAN; segmentação; escopo reduzido por design |
| **Setor regulado (BACEN, HIPAA)** | Self-hosted obrigatório; modelo em VPC do cliente |

### 18.3 Controles não negociáveis

1. Data plane no cliente; control plane sem dado sensível
2. Provedor de modelo abstraído e substituível
3. Produção sempre somente-leitura
4. Kill switch global por organização
5. Audit log imutável, 12+ meses, exportável
6. Segredos exclusivamente em cofre
7. PII mascarada antes de persistir ou prompt
8. Dados de cliente nunca treinam modelo compartilhado sem opt-in contratual

---

## 19. Stack Tecnológica e Topologia de Deploy

### 19.1 Escolhas

| Camada | Tecnologia | Justificativa |
|---|---|---|
| Runner / execução | **Node.js + TypeScript** | Mesmo ecossistema do Playwright; menor atrito |
| Automação de browser | **Playwright** | Auto-waiting, actionability, shadow DOM, iframes, trace nativo |
| Captura | **CDP** (via `CDPSession` e extensão MV3) | AX tree, DOMSnapshot, Network, Overlay |
| Backend / API | **NestJS** ou **Fastify** (TS) | Modularidade e DI para plugins de conector |
| Grafo | **Neo4j** (ou PostgreSQL + Apache AGE) | Consultas de impacto em profundidade variável |
| Relacional / índice | **PostgreSQL 16+** com **pgvector** | Metadados, calibração, embeddings |
| Fila / orquestração | **Temporal** (preferencial) ou BullMQ | Workflows longos, retry, compensação, durabilidade |
| Cache | **Redis** | Sessão, rate limit, coordenação |
| Storage de evidências | **S3 / MinIO** | Vídeos, traces, HAR, screenshots |
| Telemetria | **OpenTelemetry** | Padrão aberto, correlação FE→BE→DB |
| Front-end | **React + TypeScript** | Ecossistema e talento |
| Gateway de modelo | Abstração própria sobre Bedrock/Vertex/Azure/Anthropic/local | RN-SEC-002 |
| Empacotamento | **Docker** + **Helm** | Self-hosted em VPC do cliente |
| Monorepo | **pnpm workspaces + Turborepo** | Compartilhamento de tipos e IR |

> **Sobre Temporal:** a orquestração envolve workflows de horas, com compensação (undo de dados), retry seletivo e recuperação após falha de infraestrutura. BullMQ resolve o MVP; Temporal resolve a Fase 4 em diante. Migrar depois é caro — avaliar formalmente no fim da Fase 2.

### 19.2 Estrutura de monorepo

```
aletheia/
├─ apps/
│  ├─ control-plane/        API, orquestração, calibração, billing
│  ├─ web/                  Web App (3 modos)
│  └─ runner/               binário/container de execução
├─ packages/
│  ├─ ir/                   schema da IR, validação, migração de versão
│  ├─ world-model/          cliente de grafo, consultas, versionamento
│  ├─ diff-engine/          normalização, alinhamento, supressão
│  ├─ selector-engine/      fingerprint multi-sinal, consenso, cura
│  ├─ capabilities/         compilador, validador estático, executor
│  ├─ invariants/           catálogo e verificador
│  ├─ oracles/              diferencial, metamórfico, reconciliação
│  ├─ ingestors/            static, runtime, production, requirements, schema
│  ├─ model-gateway/        abstração de provedor, orçamento, redaction
│  ├─ connectors/           interface canônica + adaptadores
│  └─ shared/               tipos, telemetria, erros canônicos
├─ shims/
│  ├─ github-action/
│  ├─ gitlab-template/
│  ├─ azure-task/
│  ├─ jenkins-plugin/
│  ├─ bitbucket-pipe/
│  └─ cli/                  ← construir primeiro
├─ docs/
└─ CLAUDE.md
```

---

## 20. Métricas, KPIs e Observabilidade da Plataforma

### 20.1 Métricas de valor entregue ao cliente

| Métrica | Definição | Alvo |
|---|---|---|
| **Defeitos escapados** | Bugs em produção não detectados pela plataforma | ↓ 60% em 6 meses |
| **MTTD** | Tempo entre introdução e detecção do defeito | < 10 min (T1) |
| **MTTR** | Tempo até causa raiz identificada | ↓ 70% |
| **Cobertura de receita** | % da receita representada por jornadas com invariante ativo | > 85% |
| **Esforço humano de manutenção** | Horas/mês mantendo a suíte | ↓ 80% |
| **Tempo de gate** | p95 da duração do Tier 1 | < 5 min |

### 20.2 Métricas de saúde do produto

| Métrica | Alvo |
|---|---|
| Taxa de falso positivo por categoria | < 5% (L4), < 2% (L5) |
| Taxa de flake | < 1% das execuções |
| Taxa de cura de seletor aceita | > 90% |
| Taxa de resolução de seletor sem cura | > 97% |
| Aceitação de hipóteses propostas | > 40% |
| Custo de tokens por execução T1 | < USD 0,50 |
| Custo de infraestrutura por execução T1 | < USD 0,15 |
| Tempo até primeiro valor (onboarding) | < 30 min |

### 20.3 A curva que define o pitch

> **% de decisões autônomas aceitas por humanos, por categoria, ao longo do tempo.**

É a única métrica que prova que a plataforma **aprende**. Deve ser exposta ao cliente e usada em demonstração.

---

## 21. Plano de Atuação

### 21.1 Princípio de sequenciamento

> **O maior risco de execução deste projeto é tentar construir as nove capacidades simultaneamente.** Escolher a cunha é mais importante que ampliar o escopo.

Dois princípios orientam a ordem:
1. **Leitura antes de escrita** (PA-03) — o valor de oráculo vem de `SELECT`; a escrita concentra o risco.
2. **Determinístico antes de cognitivo** — o motor de diff prova o produto; o agente amplia o produto.

### 21.2 Fase 0 — Prova de vida do oráculo

| Item | Detalhe |
|---|---|
| **Duração** | 4–6 semanas |
| **Equipe** | 2 engenheiros sênior |
| **Escopo** | **Somente** teste diferencial entre duas builds de uma aplicação real, com diff semântico multi-camada e supressão de ruído. Sem UI, sem World Model, sem LLM em runtime. |
| **Entregáveis** | CLI mínima; Diff Engine (DOM, rede, visual); relatório em JSON e HTML |
| **Critério de saída** | **Detectar ≥ 5 regressões reais com < 10% de falso positivo, sem uma única linha de teste escrita** |
| **Se falhar** | O produto não existe na forma concebida. Reavaliar tese antes de qualquer investimento adicional. |

> Esta fase é inegociável. Todo o resto do projeto é engenharia conhecida; **isto** é o risco.

### 21.3 Fase 1 — Cunha comercial

| Item | Detalhe |
|---|---|
| **Duração** | 3 meses |
| **Equipe** | 4–5 engenheiros + 1 designer |
| **Proposta** | *"Detecção autônoma de regressão em todo Pull Request."* Escopo estreito, dor enorme, valor no dia 1, zero configuração. |
| **Escopo** | CLI genérica + shim GitHub Actions; Diff Engine **estendido com diff de banco (read-only)**; IR v1 + runner interpretador; motor de seletores multi-sinal; ambiente efêmero via template clone; comentário estruturado no PR |
| **Entregáveis** | Produto instalável; 3 clientes-piloto |
| **Critério de saída** | Demo "PR aberto → comentário em < 5 min" funcionando em aplicação de cliente; NPS de piloto ≥ 40 |

> **Por que o diff de banco entra já na Fase 1:** sem ele, a detecção de regressão é convencional. Com ele, a demo mostra divergência entre UI, API e persistência — algo que nenhum concorrente exibe. É o que transforma a cunha em diferencial.

### 21.4 Fase 2 — World Model

| Item | Detalhe |
|---|---|
| **Duração** | 3 meses |
| **Escopo** | Grafo semântico; Static Ingestor (repo, OpenAPI, migrations, ORM); Schema Ingestor; instrumentação OTel; análise de impacto cruzando código × jornada × tabela; versionamento por commit |
| **Critério de saída** | Seleção por risco reduz o escopo do Tier 1 em ≥ 70% sem perda de detecção; consulta de impacto responde em < 2s |
| **Marco estratégico** | A partir daqui o produto **compõe valor** — cada execução torna a próxima melhor |

### 21.5 Fase 3 — Hipóteses e cognição

| Item | Detalhe |
|---|---|
| **Duração** | 3 meses |
| **Escopo** | Hypothesizer; catálogo de invariantes; relações metamórficas; **capabilities de leitura**; reconciliação de três camadas; fila de curadoria; Modo Curadoria na UI; Tier 3 noturno |
| **Critério de saída** | ≥ 40% das hipóteses propostas aceitas por humanos; reconciliação detecta ≥ 3 classes de defeito não detectáveis por E2E tradicional |
| **Marco estratégico** | A plataforma passa a **pensar**. O oráculo dá o salto qualitativo. |

### 21.6 Fase 4 — Diagnóstico e dados de escrita

| Item | Detalhe |
|---|---|
| **Duração** | 3 meses |
| **Escopo** | Diagnostician e RCA por correlação; Narrator e relatórios executivos; **capabilities de escrita**; massa de teste autônoma (hierarquia RN-DAT-010); isolamento por clone/container; ambientes efêmeros; shims restantes de CI; conectores Jira/Slack bidirecionais |
| **Critério de saída** | MTTR reduzido em ≥ 50% nos pilotos; zero incidente de dados; massa preparada via API em ≥ 80% dos casos |

### 21.7 Fase 5 — Autonomia

| Item | Detalhe |
|---|---|
| **Duração** | Contínuo |
| **Escopo** | Escada L3 → L4 → L5 por categoria; motor de calibração; promoção/rebaixamento automático; abertura autônoma de bug; Modo Interrogatório; multi-browser; escape hatch de custom step |
| **Critério de saída** | ≥ 2 categorias em L4 com < 5% de FP em 3 clientes; primeira categoria promovida a L5 |

### 21.8 Linha do tempo consolidada

```
Mês  0    1    2    3    4    5    6    7    8    9   10   11   12   13   14   15
     ├─F0─┤
          ├──── F1 — Cunha comercial ────┤
                                         ├──── F2 — World Model ────┤
                                                                    ├─ F3 — Hipóteses ─┤
                                                                                       ├─ F4 →
     ▲                    ▲                            ▲                    ▲
     │                    │                            │                    │
  prova de            3 pilotos                 composição de          plataforma
   vida                pagos                       valor                 pensa
```

### 21.9 Composição de equipe por fase

| Fase | Backend | Frontend | ML/IA | DevOps/SRE | QA/DX | Produto |
|---|---|---|---|---|---|---|
| F0 | 2 | — | — | — | — | 0,5 |
| F1 | 3 | 1 | — | 1 | 1 | 1 |
| F2 | 4 | 1 | 1 | 1 | 1 | 1 |
| F3 | 4 | 2 | 2 | 1 | 1 | 1 |
| F4 | 5 | 2 | 2 | 2 | 1 | 1 |
| F5 | 6 | 2 | 2 | 2 | 2 | 1,5 |

### 21.10 Épicos iniciais de backlog

| ID | Épico | Fase |
|---|---|---|
| E-01 | Diff Engine — normalização e supressão de ruído | F0 |
| E-02 | Diff Engine — camada de banco de dados | F1 |
| E-03 | IR v1 — schema, validação, migração | F1 |
| E-04 | Runner interpretador | F1 |
| E-05 | Motor de seletores multi-sinal + repositório de elementos | F1 |
| E-06 | CLI genérica + shim GitHub Actions | F1 |
| E-07 | Provisionamento efêmero + template clone | F1 |
| E-08 | World Model — modelo de grafo e versionamento | F2 |
| E-09 | Static Ingestor e Schema Ingestor | F2 |
| E-10 | Strategist — seleção por risco | F2 |
| E-11 | Instrumentação OTel e correlação | F2 |
| E-12 | Hypothesizer + fila de curadoria | F3 |
| E-13 | Catálogo de invariantes + verificador | F3 |
| E-14 | Capabilities de leitura (compilador, validador, executor) | F3 |
| E-15 | Reconciliação de três camadas | F3 |
| E-16 | Diagnostician + RCA | F4 |
| E-17 | Narrator + relatórios | F4 |
| E-18 | Capabilities de escrita + massa autônoma | F4 |
| E-19 | Conectores Jira/Slack bidirecionais | F4 |
| E-20 | Motor de calibração + escada de autonomia | F5 |

---

## 22. Registro de Riscos

| ID | Risco | Prob. | Impacto | Mitigação | Dono |
|---|---|---|---|---|---|
| R-01 | Diff Engine não atinge FP < 10% na Fase 0 | Média | **Fatal** | Fase 0 dedicada; critério de saída explícito; pivô antecipado | Arquiteto |
| R-02 | Commoditização por modelo de fronteira | Alta | Alto | Fosso é World Model + calibração, não prompt | Produto |
| R-03 | Gate T1 ultrapassa 5 min | Alta | Alto | Seleção por risco, sharding, virtualização, orçamento explícito | Eng. |
| R-04 | Falso positivo destrói confiança do time | Alta | Alto | Escada de autonomia; promoção só com calibração | Produto |
| R-05 | Falso negativo cria falsa segurança | Média | Alto | RN-COB-001: sempre declarar o que não foi validado | Produto |
| R-06 | Incidente de dados (escrita indevida) | Baixa | **Fatal** | RN-DAT-006/007, capabilities, kill switch, produção read-only | Segurança |
| R-07 | Vazamento de PII para modelo | Média | **Fatal** | Mascaramento na borda; data plane no cliente | Segurança |
| R-08 | Cliente regulado não pode usar SaaS | Alta | Alto | Split control/data plane desde o dia 1 | Arquiteto |
| R-09 | Custo de tokens inviabiliza unit economics | Média | Alto | 95% determinístico; orçamento medido; cache semântico | Eng. |
| R-10 | Cliente sem maturidade para ambiente efêmero | Alta | Médio | Três modos de confiança com honestidade explícita | Produto |
| R-11 | Massa via SQL cria estado inválido → FP em cascata | Alta | Alto | Hierarquia RN-DAT-010; SQL como dívida visível | Eng. |
| R-12 | Consistência eventual gera flake estrutural | Alta | Alto | Convergência com deadline; sleep proibido | Eng. |
| R-13 | Cinco CIs viram cinco produtos | Média | Alto | PA-11: runner único + shims finos | Arquiteto |
| R-14 | Escopo explode (nove capacidades simultâneas) | **Alta** | Alto | Cunha estreita na F1; critérios de saída por fase | Produto |
| R-15 | Testes gravados testam implementação, não intenção | Média | Médio | Camada de asserção semântica + reconciliação | Eng. |
| R-16 | Ausência de escape hatch faz QA abandonar | Média | Alto | Eject para código + custom step desde F5 (protótipo em F1) | Produto |
| R-17 | Prompt injection via conteúdo da aplicação | Média | Alto | Conteúdo como dado; agente sem ferramenta destrutiva | Segurança |

---

## 23. Decisões Arquiteturais (ADRs)

### ADR-001 — Interpretador de IR, não geração de código
**Status:** Aceita
**Contexto:** Gravadores tradicionais geram código, que sofre drift e não pode ser atualizado globalmente.
**Decisão:** Runner interpreta IR declarativa. `Eject` para código é escape hatch de mão única.
**Consequências:** Self-healing centralizado; upgrade instantâneo da suíte; menor familiaridade inicial do time de dev — mitigado pelo eject.

### ADR-002 — CDP para captura, Playwright para execução
**Status:** Aceita
**Contexto:** CDP puro exigiria reimplementar auto-waiting, actionability, shadow DOM, iframes, upload.
**Decisão:** CDP para percepção (AX tree, DOMSnapshot, Network, Overlay); Playwright para execução.
**Consequências:** Anos de trabalho economizados; dependência do ciclo de release do Playwright.

### ADR-003 — LLM fora do caminho crítico
**Status:** Aceita (PA-01)
**Contexto:** Agente reinterpretando teste a cada execução gera custo, latência e não-determinismo.
**Decisão:** LLM apenas em descoberta, proposição, priorização, diagnóstico e narração.
**Consequências:** Gate confiável e barato; menos "mágica" aparente na demo — compensada pela qualidade do resultado.

### ADR-004 — Grafo como fonte da verdade semântica
**Status:** Aceita
**Contexto:** Consultas de impacto são transitivas e de profundidade variável.
**Decisão:** Neo4j (ou PostgreSQL + AGE) para o World Model; PostgreSQL para metadados e calibração.
**Consequências:** Consultas de impacto naturais; custo operacional de mais um datastore.

### ADR-005 — Separação control plane / data plane desde o dia 1
**Status:** Aceita
**Contexto:** Clientes regulados não permitem que código, dados e credenciais saiam da VPC.
**Decisão:** Data plane sempre no cliente; control plane sem dado sensível.
**Consequências:** Vende para mercado regulado; maior complexidade de deploy e observabilidade.

### ADR-006 — IR versionada em Git, dentro do repositório da aplicação
**Status:** Aceita
**Contexto:** Teste deve viver perto do código e ser revisável em PR.
**Decisão:** Git é fonte da verdade da IR e das capabilities; PostgreSQL apenas indexa.
**Consequências:** Versionamento e revisão gratuitos; exige sincronização bidirecional com a UI.

### ADR-007 — Capabilities como única via de acesso a banco
**Status:** Aceita (PA-04)
**Contexto:** LLM com conexão de banco é risco inaceitável e barreira de venda.
**Decisão:** Descoberta em design time, execução via capability compilada e aprovada.
**Consequências:** Elimina o risco crítico; adiciona etapa de aprovação — mitigada por proposição automática.

### ADR-008 — Descartabilidade em vez de cleanup
**Status:** Aceita (PA-06)
**Contexto:** Cleanup apodrece e falha justamente quando o teste falha.
**Decisão:** Template clone / container efêmero. Compensação é modo degradado explícito.
**Consequências:** Isolamento real; exige maturidade de infraestrutura do cliente — endereçada pelos três modos de confiança.

### ADR-009 — Um runner, muitos shims
**Status:** Aceita (PA-11)
**Contexto:** Suportar 6+ provedores de CI como integrações independentes multiplica custo.
**Decisão:** Runner único; shims de ~50 linhas; CLI genérica construída primeiro.
**Consequências:** Novo provedor em um dia; shims não podem conter lógica de negócio.

### ADR-010 — Autonomia por categoria, com calibração
**Status:** Aceita
**Contexto:** Autonomia global é rejeitada por qualquer CTO responsável.
**Decisão:** Escada L1–L5 promovida por categoria mediante precisão calibrada.
**Consequências:** Adoção gradual e confiável; exige coleta disciplinada de feedback desde a Fase 1.

---

## 24. Estratégia de Demonstração e Go-to-Market

### 24.1 O que **não** dizer em feira

> *"IA que testa sua aplicação."*

Haverá cinco estandes vizinhos dizendo o mesmo. Isso posiciona o produto como commodity.

### 24.2 O que dizer

> **"Nós não escrevemos testes. Construímos um modelo vivo do seu sistema, descobrimos as verdades que ele precisa manter, e avisamos no minuto em que uma delas deixa de ser verdade."**

### 24.3 A demo de palco

**Roteiro (7 minutos):**

1. **(0:00)** Aplicação real, escolhida pela plateia entre 3 opções pré-conectadas. Nenhum teste escrito. Nenhuma configuração.
2. **(0:30)** Mostrar o World Model já construído: mapa da aplicação, endpoints, tabelas, jornadas mineradas de produção com % de receita.
3. **(1:30)** Um desenvolvedor da plateia introduz um bug sutil de regra de negócio — trocar `0.15` por `0.10` no cálculo de desconto. Abrir PR ao vivo.
4. **(2:00)** Enquanto executa: mostrar a fila de curadoria da noite anterior. PO da plateia responde 3 perguntas de sim/não em 40 segundos.
5. **(4:00)** Comentário aparece no PR: jornadas impactadas, % de receita afetada, divergência UI × API × banco, causa raiz na linha exata, evidências anexadas.
6. **(5:30)** Mostrar a curva de aceitação de decisões autônomas ao longo de 90 dias em cliente real.
7. **(6:30)** Fechar com a frase da Seção 24.2.

**O que torna esta demo não replicável pelos concorrentes:** a divergência entre camadas (passo 5) e a curva de calibração (passo 6). Ambas exigem World Model e histórico acumulado — não são produzíveis com prompt.

### 24.4 Segmentação inicial

| Segmento | Por quê | Objeção principal |
|---|---|---|
| Fintech / e-commerce de médio porte | Regra de negócio financeira crítica; dor de regressão alta; maturidade de CI | "e se a IA errar?" → escada de autonomia |
| SaaS B2B com alta frequência de deploy | Gate de PR é dor diária | "5 minutos é muito" → seleção por risco |
| Empresas com QA manual grande | ROI de headcount evidente | "vai substituir meu time?" → reposicionamento para estrategista |

### 24.5 Modelo de precificação (hipótese a validar)

Precificar por **jornada crítica sob gestão** ou por **execução de gate**, nunca por "usuário" — o modelo por usuário é hostil à tese de acesso universal, que quer PO, BA e gerente dentro da plataforma.

---

## 25. Glossário

| Termo | Definição |
|---|---|
| **AUT** | Application Under Test — aplicação sob teste |
| **Capability** | Operação de banco compilada, parametrizada e aprovada; única via de acesso a dados |
| **Cunha** | Escopo inicial estreito com valor imediato, usado para entrar no cliente |
| **Diff Engine** | Motor determinístico de comparação semântica multi-camada |
| **Escada de Autonomia** | Modelo L1–L5 de delegação progressiva por categoria |
| **Fingerprint de seletor** | Conjunto ponderado de sinais que identifica um elemento |
| **Invariante** | Propriedade que deve ser verdadeira em toda execução, independentemente do teste |
| **IR** | Intermediate Representation — representação declarativa de uma jornada |
| **Jornada** | Sequência de interações que realiza um objetivo de negócio |
| **Modo de confiança** | `ISOLATED` \| `PARTITIONED` \| `SHARED_DEGRADED` — nível de isolamento da execução |
| **Oráculo** | Fonte de verdade contra a qual o comportamento observado é julgado |
| **Reconciliação de três camadas** | Comparação do mesmo fato em UI, API e persistência |
| **Relação metamórfica** | Propriedade que relaciona duas execuções sem declarar a saída correta |
| **Shim** | Adaptador fino que integra o runner a um provedor de CI |
| **Teste diferencial** | Execução paralela contra base e head, com comparação semântica |
| **World Model** | Grafo semântico versionado que representa o conhecimento sobre a aplicação |

---

## Controle de Versão do Documento

| Versão | Data | Autor | Mudança |
|---|---|---|---|
| 1.0 | 2026-08-10 | Arquitetura | Versão inicial completa |

> **Este é um documento vivo.** Alterações em Princípios Arquiteturais (Seção 4) ou em regras marcadas 🔒 exigem ADR formal e aprovação do arquiteto responsável.
