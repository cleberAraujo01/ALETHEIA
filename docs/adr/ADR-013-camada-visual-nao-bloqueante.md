# ADR-013 — Camada visual reporta, mas não bloqueia

**Status:** aceito · Fase 0 (revisão prevista na Fase 2)
**Data:** 2026-08-10
**Contexto arquitetural:** PA-10, RN-ORC-009, RN-COB-001; ARQUITETURA.md §12.4

## Contexto

O diff visual é a camada com maior taxa de falso positivo por construção:
qualquer mudança intencional de layout altera milhares de pixels e é
indistinguível de uma quebra **sem uma fonte de intenção**. Na Fase 0 não
existe nenhuma: não há World Model, não há proximidade ao diff de código, não
há jornada anotada com valor de negócio.

Ao mesmo tempo, remover a camada não é opção — ela é o único oráculo que pega
regressão puramente visual (componente que sumiu de vista, sobreposição,
contraste quebrado), que DOM e rede não enxergam.

## Decisão

A camada visual roda, reporta região por região, e tem **teto de severidade
MEDIUM**. Como o limiar de regressão é 70 e MEDIUM vale 40, nenhum delta visual
pode ser classificado como `REGRESSION` nesta fase. Todos caem em
`UNDETERMINED`, que aparece no relatório e nunca bloqueia (RN-ORC-009).

A comparação em si é por região, não por pixel, com três filtros de ruído
declarados: distância perceptual YIQ com limiar, densidade mínima por célula de
8×8 (que descarta antialiasing e hinting de fonte), e máscaras declaradas na
captura para áreas sabidamente dinâmicas.

O teto está no código como `VISUAL_SEVERITY_CEILING` e a nota correspondente
aparece na declaração de cobertura de **todo** relatório emitido.

## Consequências

**Positiva** — medido contra aplicação real: duas capturas independentes da
mesma build, 7 rotas com screenshots de página inteira (1280×5613 na maior),
produziram **zero** regiões visuais divergentes. O filtro de densidade sustenta
o custo de manter a camada ligada.

**Positiva** — mutação sintética de um bloco de 500×220 pixels foi localizada
com precisão (região reportada em 120,400 504×224, encaixada na grade de 8 px).

**Negativa e explícita** — uma regressão exclusivamente visual não reprova o PR
nesta fase. Ela aparece como `UNDETERMINED` e depende de triagem humana. Isso é
uma perda de detecção assumida, registrada aqui para não parecer descuido.

## Como esta decisão será revista

O teto sobe quando uma das duas condições existir:

1. **Proximidade ao diff de código** (Fase 2): permite separar "mudou onde o PR
   mexeu" — provavelmente intencional — de "mudou onde ninguém mexeu", que é o
   caso interessante. É a mudança que torna o visual acionável.
2. **Medição de corpus**: taxa de falso positivo visual abaixo de 10% em
   aplicação real, com as regiões rotuladas manualmente.

Enquanto nenhuma existir, subir o teto é trocar falso negativo declarado por
falso positivo silencioso — que destrói a confiança no gate mais rápido.
