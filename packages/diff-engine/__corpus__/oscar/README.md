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
| `intentional.mjs` | As 4 mudanças **legítimas** (sem defeito nenhum), com o commit upstream de cada |
| `apply-intentional.mjs` | Aplica a inversa delas, produzindo a build `pr-antes` |
| `label-intentional.mjs` | Rotula o par intencional: qual mudança é `INTENDED_CHANGE` (uma vez, de propósito) e qual é `NOISE` (padrão desta aplicação). Só `NOISE` alimenta supressão |
| `suppressions.json` | As regras que `aletheia suppress propose` aprendeu do par intencional — todas `PROPOSED`, nenhuma ativável com um único PR (§10.12 da medição) |

São **dois** corpora, e eles medem coisas opostas: o de defeito mede detecção, o
de mudança intencional mede falso positivo. Um número sozinho não diz nada —
detectar tudo é trivial se reprovar todo mundo for aceitável.

**Estado atual do corpus intencional: 20 deltas bloqueantes, todos falso
positivo** (§10.6 e §10.7 do documento de medição). Eram 22; os 2 de reembalagem
foram consertados. Os 20 restantes são links que saíram do menu numa mudança
legítima — e a ablação da §10.8 provou que eles são **sobredeterminados**: as
regras de nó interativo e de texto perdido os marcam HIGH independentemente, e só
somem retirando as duas, ao custo de 4 defeitos. Não é problema de regra, é falta
de sinal. **Não tente resolver mexendo em severidade.**

**A supressão aprendida os cobre em tese, e não em prática ainda** (§10.12).
`label-intentional.mjs` rotula `M1` como `NOISE` — o menu "Browse store" é gerado
da árvore de categorias, item entrando e saindo dali é manutenção de catálogo —
e o aprendizado produziu duas regras `PROPOSED` (`SUP-oscar-001/002`) com custo
simulado **zero** nos 7 defeitos: `O4` mora no mesmo menu, mas é mudança de `href`,
e a assinatura leva o tipo. Ativar exige evidência de 3 execuções distintas e há
um PR; faltam dois PRs do oscar que mexam no menu. A `note` do rótulo diz o que se
aceita deixar de ver: um bug que apague um nível do menu passaria.

O que **não** tem: a aplicação, as capturas, os relatórios e os screenshots.
Pesam e são reconstituíveis — ver §10.4 do documento de medição.

## Duas decisões de método que sustentam o número

**Dois candidatos foram descartados DEPOIS de medidos**, e o registro fica em
`faults.mjs`: o preço exibido sem imposto (no sandbox o imposto é zero, então a
troca não muda nada na página) e o botão "voltar" da página de produto (só
renderiza com referrer, e a jornada navega direto por URL). Escolher defeito por
detectabilidade é como se produz número bonito e vazio; descartar defeito que
não se manifesta é outra coisa, e precisa ficar escrito qual dos dois aconteceu.

**A ponte para a camada visual exige medição, e uma medição correta não basta se
o ambiente estiver errado.** Atribuir delta de pixel a um defeito por
proximidade é fabricar acerto, então `O7-miniatura-sem-alt` — que não deveria
mover pixel nenhum — foi aplicado **sozinho** antes de ser declarado com efeito
visual. A altura de toda página com listagem mudou, e na mesma medida do
conjunto completo. Evidência aparentemente sólida.

Estava errada: o sandbox tinha sido montado sem `npm run build`, o CSS respondia
404, e sem CSS nada fixa a dimensão da miniatura — imagem não pintada renderiza
o texto do `alt` e ocupa espaço. Com os assets compilados, nenhuma altura muda e
os 452 deltas visuais viram 33. Ver §10.3.1 do documento de medição. **Se o
`curl` do `styles.css` não devolver 200, qualquer número desta medição vale
nada.**

## Alterar este corpus

1. Defeito novo declara `origem` honestamente. `HISTORICO` exige o commit
   upstream que o corrigiu, e a correção precisa ainda existir no template atual
   — senão não há o que inverter.
2. `apply-faults.mjs` falha se qualquer trecho não casar exatamente. Conjunto
   aplicado pela metade invalidaria a medição em silêncio.
3. Toda mudança reporta o delta de precisão e recall nos **dois** corpora de
   defeito (`juventude` e `oscar`) e no de mudança intencional.
