# ADR-011 — Normalização por valor de UUID e timestamp no Diff Engine

**Status:** aceito · Fase 0
**Data:** 2026-08-10
**Contexto arquitetural:** ARQUITETURA.md §12.4; CLAUDE.md §6.4 e PA-10

## Contexto

O teste diferencial (O5) compara duas execuções distintas da aplicação. Cada
execução gera identificadores próprios (`orderId`, `sessionId`, ids de recurso)
e ocorre em instantes diferentes, produzindo timestamps diferentes.

Sem tratamento, **toda** comparação diverge — inclusive base contra base. O
motor seria inútil antes de encontrar o primeiro defeito real.

A normalização por **chave** (`createdAt`, `requestId`, `token`) resolve parte
do problema, mas não alcança o caso em que a chave é neutra e o valor é que é
volátil — por exemplo `{"reference": "8c7d6e5f-2222-..."}`.

## Decisão

O Diff Engine normaliza, **pelo valor**, dois padrões:

| Padrão | Substituição | Regra |
|---|---|---|
| UUID e hex de 32+ caracteres | `<uuid>` | `NORM-NET-005` |
| Data-hora ISO-8601 | `<timestamp>` | `NORM-NET-006` |

Números **não** são normalizados por valor em hipótese alguma: total, preço,
percentual e contagem são exatamente o que o produto precisa comparar.

Toda aplicação é contabilizada no ledger de normalização e aparece no
relatório com o id da regra e a contagem.

## Consequências

**Positiva** — base contra base produz zero deltas (verificado no corpus
`__fixtures__/checkout/base-rerun.json`). É o pré-requisito para qualquer
medição de falso positivo.

**Negativa, e é a razão deste registro existir** — um defeito cujo sintoma seja
uma data errada em campo ISO-8601, ou uma referência UUID trocada pela de outro
registro, passa despercebido. Isso é falso negativo, que PA-10 classifica como
pior que falso positivo.

O risco foi aceito porque a alternativa (não normalizar) elimina o motor
inteiro, e porque §12.4 lista timestamps explicitamente como ruído a suprimir.

## Como esta decisão será revista

É a **primeira** candidata a medição quando houver corpus de aplicação real:

1. Rotular manualmente os casos em que a normalização por valor escondeu
   divergência verdadeira.
2. Se a taxa for relevante, trocar por normalização **relativa**: comparar o
   delta de tempo entre base e head em vez de descartar o valor, e comparar a
   *estrutura de referência* (o UUID X aponta para o mesmo registro nos dois
   universos?) em vez do literal.

Enquanto a medição não existir, os números e padrões desta ADR são hipótese.
