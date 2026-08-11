# Corpus `juventude`

Corpus de referência do Diff Engine, construído sobre uma aplicação real em
produção (Next.js 15, sete rotas, sem `data-testid`).

Resultado e leitura completa: [`docs/medicao-fase-0.md`](../../../../docs/medicao-fase-0.md).

## O que tem aqui

| Arquivo | Papel |
|---|---|
| `faults.mjs` | Os 9 defeitos, com proveniência (`HISTORICO` × `INJETADO`), sintoma e o commit que corrigiu cada um dos históricos |
| `apply-faults.mjs` | Aplica os defeitos ao código-fonte de uma cópia da aplicação |
| `label.mjs` | Atribui cada delta do relatório a um defeito, ou a ruído |

O que **não** tem: capturas, relatórios e screenshots. Pesam, e são
reconstituíveis — ver §8 do documento de medição.

## Duas propriedades que sustentam a medição

**O defeito está no código, não no artefato.** `tools/mutate-capture.mjs` mutila
o JSON de captura e prova o motor de diff isoladamente. Aqui o defeito atravessa
build, renderização, navegador e captura, como um defeito de verdade. Foi só por
isso que a medição descobriu que uma rota quebrada tornava a build inteira
inobservável — nenhuma mutação de JSON produziria esse efeito.

**A rotulagem fecha para baixo.** `label.mjs` não lê `classification`,
`severity` nem `score`: olha o que mudou e confronta com as alterações de
código-fonte que nós mesmos aplicamos. Delta que não casa com nenhuma assinatura
de defeito é ruído, sempre — nunca o contrário. Assim todo erro da rotulagem
pesa contra o motor, e não a favor dele.

## Alterar este corpus

Mudar `faults.mjs` muda o número que atesta o critério de saída da Fase 0.
Portanto:

1. Defeito novo declara `origem` honestamente. `HISTORICO` exige o commit que o
   corrigiu.
2. `apply-faults.mjs` falha se qualquer trecho não casar exatamente. Conjunto
   aplicado pela metade invalidaria a medição em silêncio — por isso ele não
   tenta ser tolerante.
3. Toda mudança reporta o delta de precisão e recall nos **dois** corpora: o de
   defeitos e o de mudança intencional (§7 do CLAUDE.md). Um número sozinho não
   diz nada: detectar mais é fácil se reprovar todo mundo for aceitável.
