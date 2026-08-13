# Corpus `oscar`

Segundo corpus de referência do Diff Engine — o que a §7 do relatório de medição
pedia. Construído sobre o sandbox do [django-oscar](https://github.com/django-oscar/django-oscar):
e-commerce Python/Django renderizado no servidor, 201 produtos, token CSRF em
todo formulário.

Resultado e leitura completa: [`docs/medicao-fase-0.md`](../../../../docs/medicao-fase-0.md) §10.

## Por que esta aplicação

O primeiro corpus (`juventude`) é Next.js, foi escrito por nós, e as duas regras
de severidade que fecharam a Fase 0 foram desenhadas depois de ver os dados dele.
Um segundo corpus só vale se for **estranho**:

| | `juventude` | `oscar` |
|---|---|---|
| Stack | Next.js 15, App Router | Python/Django, template no servidor |
| Autoria | nossa | terceiros, anos antes deste motor existir |
| Defeito histórico vem de | commits nossos | commits do projeto upstream |
| Token por sessão | não tem | CSRF em todo formulário |
| Diferença entre base e head | defeitos **+ processo de build** | **só** os defeitos |

A última linha é a mais importante. Em `juventude`, boa parte do ruído vinha do
bundler (hash de conteúdo, identificador de build). Aqui Django lê o template a
cada request: não há passo de build, e as duas builds diferem exclusivamente
pelos sete defeitos. Todo delta ou vem de um defeito, ou é ruído do próprio
motor. É um teste mais duro, e de propósito.

## O que tem aqui

| Arquivo | Papel |
|---|---|
| `faults.mjs` | Os 7 defeitos, com proveniência (`HISTORICO` × `INJETADO`), sintoma e o commit upstream que corrigiu cada histórico |
| `apply-faults.mjs` | Aplica os defeitos aos templates de uma cópia do django-oscar |
| `label.mjs` | Atribui cada delta do relatório a um defeito, ou a ruído |

O que **não** tem: a aplicação, as capturas, os relatórios e os screenshots.
Pesam e são reconstituíveis — ver §10.4 do documento de medição.

## Duas decisões de método que sustentam o número

**Dois candidatos foram descartados DEPOIS de medidos**, e o registro fica em
`faults.mjs`: o preço exibido sem imposto (no sandbox o imposto é zero, então a
troca não muda nada na página) e o botão "voltar" da página de produto (só
renderiza com referrer, e a jornada navega direto por URL). Escolher defeito por
detectabilidade é como se produz número bonito e vazio; descartar defeito que
não se manifesta é outra coisa, e precisa ficar escrito qual dos dois aconteceu.

**A ponte para a camada visual foi medida, não suposta.** Atribuir delta de pixel
a um defeito por proximidade é fabricar acerto. O defeito `O7-miniatura-sem-alt`
não tem efeito visual óbvio — remover `alt` não deveria mover nada. Antes de
declará-lo com efeito de pixel, ele foi aplicado **sozinho**: a altura da página
mudou exatamente nas páginas com listagem de produto e exatamente na mesma
medida do conjunto completo (`/en-gb/offers/`: 10737 → 10755 px nos dois casos).
A causa é que imagem ainda não pintada renderiza o texto do `alt`, que ocupa
espaço. Sem essa medição, os 132 deltas visuais daquela página seriam ruído.

## Alterar este corpus

1. Defeito novo declara `origem` honestamente. `HISTORICO` exige o commit
   upstream que o corrigiu, e a correção precisa ainda existir no template atual
   — senão não há o que inverter.
2. `apply-faults.mjs` falha se qualquer trecho não casar exatamente. Conjunto
   aplicado pela metade invalidaria a medição em silêncio.
3. Toda mudança reporta o delta de precisão e recall nos **dois** corpora de
   defeito (`juventude` e `oscar`) e no de mudança intencional.
