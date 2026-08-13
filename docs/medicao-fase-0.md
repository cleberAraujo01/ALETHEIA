# Medição de saída da Fase 0

**Data:** 2026-08-11
**Critério (§21.2):** detectar ≥ 5 regressões reais com < 10% de falso positivo,
sem uma única linha de teste escrita.
**Resultado:** **atingido** — 5 defeitos distintos bloqueados de 9 presentes,
0% de falso positivo no recorte bloqueante, 9 de 9 defeitos visíveis na triagem.
Um PR legítimo da mesma aplicação passou sem nenhum delta bloqueante.

Este documento existe para que o número acima possa ser contestado. Ele registra
o que foi medido, contra o quê, o que ficou de fora e o que ainda não sabemos.

---

## 1. Aplicação e builds

Aplicação real em produção: site institucional da Associação Atlética Juventude
(Next.js 15, App Router, Tailwind 4). Sete rotas, ~350 nós de DOM por página,
nenhum `data-testid`.

Duas builds servidas localmente a partir de clones descartáveis do repositório:

| Build | Origem |
|---|---|
| `base` | commit `7aeb5c3` — o código como está |
| `head` | `7aeb5c3` + os 9 defeitos do corpus `juventude` |
| `pr-antes` | commit `7755d4d` — o pai de `7aeb5c3` |

O par `pr-antes` × `base` é um **PR real da aplicação**, com mudança apenas
intencional. Ele existe porque sem ele metade da medição seria fantasia: um
corpus onde toda diferença é defeito não consegue dizer nada sobre falso
positivo. É fácil fazer um motor detectar tudo; o difícil é não reprovar quem
não errou.

## 2. Os defeitos

Nove, declarados em `packages/diff-engine/__corpus__/juventude/faults.mjs`, com
proveniência explícita:

| Origem | Quantos | O que significa |
|---|---|---|
| `HISTORICO` | 5 | **Esteve em produção nesta aplicação** e foi corrigido por um commit real, cuja mensagem descreve o sintoma. Reconstituído no HEAD pela transformação inversa da correção |
| `INJETADO` | 4 | Plantado por nós. Do tipo que este código comporta (rota com erro de digitação, atributo de validação perdido, dígito trocado em contato, off-by-one em listagem), mas nunca esteve em produção |

Somar os dois e anunciar "9 regressões reais" seria mentira, por isso a tabela.

A diferença em relação à medição anterior (`tools/mutate-capture.mjs`, que
mutila o artefato de captura) é de natureza, não de grau: aqui o defeito está no
**código-fonte** e atravessa build, renderização, navegador e captura. Foi
justamente isso que revelou os dois achados da seção 4 — nenhum deles apareceria
mutando JSON.

## 3. Contagem por defeito, não por delta

Um defeito produz muitos deltas. O link de menu quebrado aparece no cabeçalho e
no rodapé de sete páginas: 27 deltas, um defeito.

A medição anterior contava deltas. Pelo critério "≥ 5 regressões reais", esse
único defeito atestaria a fase inteira seis vezes. A rotulagem agora declara o
defeito de origem de cada delta (`LabelEntry.defect`) e a medição conta defeitos
distintos; regressão rotulada sem defeito declarado impede a contagem em vez de
passar batido.

## 4. O que a medição encontrou no nosso próprio código

**Um falso negativo silencioso.** O número de WhatsApp do clube trocado num
dígito (`wa.me/5511941126936` → `…939`) produzia **zero deltas**. A normalização
colapsava segmento numérico de path em `:id` — regra correta para alinhar
`/orders/1042` com `/orders/1043` — e aplicava a mesma regra ao `href` de um
link, onde não há nada a alinhar: o nó já foi emparelhado pela estrutura.
Normalizar ali não comprava alinhamento e apagava o defeito.

Corrigido separando o propósito da normalização (`ALIGNMENT` × `VALUE`). É o
caso central do problema do oráculo: a página renderiza, o botão funciona, a
conversa abre — no número errado.

**Uma build inobservável.** O prefetch da rota quebrada recebe 404 e a aplicação
abandona o corpo; a requisição fica em voo para sempre e a captura morria de
`TIMEOUT_CONVERGENCE` nas sete páginas. Um defeito que o motor detecta em
segundos impedia qualquer veredito. Corrigido em [ADR-014](./adr/ADR-014-resposta-nao-drenada-na-convergencia.md).

## 5. Números

Piso de ruído — duas capturas independentes da **mesma** build: **0 deltas**,
incluindo camada visual.

### Corpus de defeitos

| | Antes | Depois |
|---|---|---|
| Deltas totais | 298 | 223 |
| Deltas de ruído | 142 | **50** |
| Precisão na triagem | 52,3% | **77,6%** |
| Defeitos visíveis | 8 de 9 | **9 de 9** |
| Defeitos bloqueados | 1 de 9 | **5 de 9** |
| Falso positivo bloqueante | 0% | **0%** |

"Antes" e "depois" separam quatro mudanças, todas com evidência medida:

1. **Normalização de hash de bundle** (`NORM-NET-007`). Das 177 divergências de
   rede, 110 eram `/_next/static/chunks/…-<hash>.js` — o mesmo módulo com outro
   nome porque o bundler rodou. 62% do ruído de rede vinha daí. Imagem ficou de
   fora de propósito: trocar a arte é mudança de conteúdo.
2. **Propósito de normalização de URL** — o falso negativo da seção 4.
3. **`href`/`action` que muda → HIGH.** Destino de ação do usuário. `src` ficou
   fora: no PR real, `src`, `srcset` e `loading` mudaram em cinco páginas porque
   a imagem do banner foi recomprimida. Subir `src` junto teria reprovado um PR
   legítimo — o corpus intencional pagou por si nesta linha.
4. **Nó com texto que desaparece → HIGH.** Conteúdo que o usuário deixou de
   receber, distinto de invólucro removido em refatoração.

### Corpus de mudança intencional (PR real)

68 deltas, **nenhum bloqueante**. Nenhum delta visual. O gate não reprova quem
não errou — que é a condição para o time do cliente continuar confiando nele.

## 6. O que passou, e por quê

Quatro defeitos aparecem na triagem mas não bloqueiam:

| Defeito | Por que não bloqueia |
|---|---|
| `F1-splash-global` | Vive **antes da hidratação**. A captura observa o estado convergido, e a hidratação já desmontou o splash. Sobra o rastro da imagem que ele pede — um delta, `LOW` |
| `F2-contraste-aa` | Troca de classe CSS. Sem régua de contraste, o motor vê `text-white` → `text-paper`, não "4,2:1 reprova AA" |
| `F3-ticker-contraste` | Idem |
| `F7-email-sem-required` | `required` perdido é `DOM_ATTRIBUTE_REMOVED` comportamental, `MEDIUM`. Subir todo atributo comportamental a `HIGH` reprovaria o PR real, que mexeu em `loading` |

Os três primeiros são acessibilidade, e a leitura honesta é que **este motor não
tem oráculo de acessibilidade**. Um verificador de contraste é conhecimento
externo sobre a build, não diferença entre duas builds — cabe em invariantes
(Fase 3), não aqui.

## 7. Limites desta medição — leia antes de citar o número

- **Uma aplicação, um PR intencional.** As duas regras de severidade novas
  foram desenhadas depois de ver estes dados. Isso as torna hipóteses com
  evidência, não regras estabelecidas. Um segundo corpus, de outra aplicação,
  pode derrubá-las — e é o próximo experimento que o projeto deve rodar.
  **Rodado em 2026-08-13 (§10): não derrubou.** O que continua faltando é um
  corpus de mudança intencional na segunda aplicação.
- **4 dos 9 defeitos são injetados.** Os 5 bloqueados são F4, F5, F6, F8, F9 —
  três históricos e dois injetados.
- **O corpus de defeitos não mede falso positivo de mudança intencional**, e o
  corpus intencional não mede detecção. Os dois números vêm de corpora
  diferentes e não devem ser somados.
- **A rotulagem é automática**, por assinatura de defeito
  (`__corpus__/juventude/label.mjs`), e não consulta o veredito do motor. Ela
  fecha para baixo: delta que não casa com nenhuma assinatura é ruído, sempre.
  Todo erro dela pesa contra o motor, nunca a favor.
- **Dois pisos de ruído contra stack desconhecida** (§8, §9) já pegaram falso positivo bloqueante antes de qualquer segundo corpus, as duas vezes na mesma regra. Repetir esse teste barato a cada regra nova.
- **Camadas não validadas:** console (capturado, não comparado), banco e trace.
- **O oráculo é O5.** Defeito que já existia na base é invisível por construção.

## 8. Adendo — primeira aplicação desconhecida (2026-08-11, mesmo dia)

Tela de SSO da ANBIMA (`sso.cer.anbima.cloud`, ambiente de teste), Keycloak.
Stack que não escrevemos e contra a qual nada foi calibrado. Uma página, duas
capturas, **mesma build**.

**Resultado inicial: 3 deltas, 2 deles BLOQUEANTES.** A mesma build seria
reprovada por ela mesma. E os dois bloqueavam por causa da regra `href`/`action`
→ HIGH criada horas antes: a hipótese calibrada contra uma aplicação encontrou
seu contraexemplo na primeira aplicação estranha que viu.

| Delta | Valor |
|---|---|
| `a[FORGOT_PASSWORD]@href` | `tab_id=FLQAJ0n7Qoo` → `OTbn5RUDMjM` |
| `form#kc-form-login@action` | `session_code=soFbAY…fe0` → `eBLQ3P…nmQ` |

Tokens de uso único, gerados por request. O `execution=<uuid>` ao lado deles já
era normalizado; estes escapavam por não terem formato de UUID.

O conserto **não** foi reverter a regra de `href` — ela sustenta a detecção do
defeito de contato trocado. Foi fechar a lacuna de normalização
(`NORM-NET-008`), com uma conjunção que quase virou o erro oposto: o nome do
parâmetro sozinho apagaria `state=SP` numa aplicação brasileira, e um piso de
comprimento menor apagaria id de vídeo do YouTube — que a aplicação do corpus
`juventude` tem. Ambos travados em teste.

| Corpus | Antes | Depois |
|---|---|---|
| ANBIMA, mesma build | 3 deltas, 2 bloqueantes | **1 delta, 0 bloqueantes** |
| Juventude, mesma build | 0 | 0 |
| Juventude, PR real | 68, nenhum bloqueante | 68, nenhum bloqueante |
| Juventude, 9 defeitos | 5 bloqueados, 0% FP | 5 bloqueados, 0% FP |

O delta remanescente é o corpo do HTML, que traz os mesmos tokens embutidos.
Fica como `UNDETERMINED` e não bloqueia. Normalizar token dentro de HTML seria
apagar conteúdo às cegas — a lacuna é declarada, não fechada.

**O que este adendo NÃO é.** Não é o segundo corpus pedido na §7: uma página,
uma build, zero defeitos. Mede piso de ruído contra stack desconhecida, e nada
sobre detecção. Mas já custou uma lição barata: **regra de severidade nova
merece um piso de ruído numa aplicação estranha antes de ser considerada
estável** — duas capturas de uma página só, e o contraexemplo apareceu.

Também confirmou dois limites de escopo, sem surpresa: a área autenticada é
inalcançável porque a jornada da Fase 0 não tem ações (isso é IR, Fase 1), e
uma aplicação em produção sozinha não tem `base` e `head` — o oráculo O5 não
tem contra o que julgar.

## 9. Adendo — segunda aplicação desconhecida (2026-08-13)

ParaBank (Parasoft), instância pública hospedada. Java/JSP servido por contêiner
de Servlet — nenhum parentesco com Next.js em dimensão nenhuma. Seis páginas
públicas, duas capturas, **mesma build**.

Escolhida por ser o adversário natural da regra sob suspeita: aplicação com
sessão de servidor e formulário com `action`. A hipótese de que ela teria
injeção de defeito configurável no admin **não se confirmou** — o admin da
instância hospedada só configura datasource, saldo e JMS. Então isto é piso de
ruído, não corpus de defeito.

**Resultado inicial: 44 deltas, 28 BLOQUEANTES.** De novo a mesma build
reprovando a si mesma, e de novo pela regra `href`/`action` → HIGH.

Causa única para os 44: `;jsessionid=<hex>` — identidade de sessão embutida no
**path**, como parâmetro de segmento (RFC 3986 §3.3), que é o rewriting de URL
que contêiner de Servlet aplica quando não pode contar com cookie.

Pior que o caso Keycloak em dois sentidos:

- **contamina tudo**, não um parâmetro de fluxo de autenticação: `href`, `src`,
  `action` e a URL de todo recurso estático;
- **quebra o alinhamento de rede**, não só a comparação de valor. Os mesmos 6
  recursos apareceram como 6 `REQUEST_REMOVED` + 6 `REQUEST_ADDED`, e o diff de
  corpo — que é onde mora o valor — nunca aconteceu. Enquanto o parâmetro ficava
  grudado no segmento, `style.css;jsessionid=…` não terminava em `.css` e
  nenhuma das regras de normalização reconhecia o que estava olhando.

Fechado em `NORM-NET-009`, com a mesma disciplina de conjunção nome+forma do
`NORM-NET-008`. Duas escolhas que merecem registro:

1. **Normaliza nos DOIS propósitos** — deliberadamente o oposto do que se faz
   com identificador de path (§4). Lá, apagar o id no propósito `VALUE` custava
   detecção, porque o id era conteúdo de negócio. Id de sessão não é: é criado
   pelo contêiner, não sobrevive a duas execuções nem na mesma build, e não há o
   que comparar.
2. **Lista de nomes curta.** `sid` ficou de fora por ser plausível como
   identificador de negócio; ColdFusion (`cfid`/`cftoken`) também, por não
   termos como medir. Entrada não testada é dívida, não cobertura.

| Corpus | Antes | Depois |
|---|---|---|
| ParaBank, mesma build | 44 deltas, 28 bloqueantes | **2 deltas, 0 bloqueantes** |
| ANBIMA, mesma build | 1 delta, 0 bloqueantes | 1, 0 |
| Juventude, mesma build | 0 | 0 |
| Juventude, PR real | 68, nenhum bloqueante | 68, nenhum bloqueante |
| Juventude, 9 defeitos | 5 bloqueados, 0% FP | 5 bloqueados, 0% FP |

Detecção não se moveu: precisão 100% e recall 27,7% no recorte bloqueante,
precisão 77,6% e recall 100% na triagem, 5 defeitos distintos bloqueados de 9.

Os 2 deltas remanescentes do ParaBank são a **mesma lacuna já declarada na §8**,
em dois recipientes: o corpo do HTML e um `url()` dentro de atributo `style`.
Ambos `UNDETERMINED`, nenhum bloqueia. A decisão continua a mesma — normalizar
token dentro de conteúdo livre é apagar às cegas. Fica declarada, não fechada.

**O que este adendo NÃO é.** Continua não sendo o segundo corpus pedido na §7:
uma build, zero defeitos, nada sobre detecção.

**O que ele acrescenta.** Duas aplicações desconhecidas, dois piso de ruído,
**duas vezes a mesma regra quebrando** — sempre por identidade de sessão ou
token dentro de URL, nunca pelo destino real de uma ação. A regra `href`/`action`
→ HIGH não se mostrou errada: ela sustenta a detecção do defeito de contato
trocado, e nas duas vezes o conserto certo foi a normalização, não reverter a
regra. Mas ela é hoje o **ponto de concentração de risco** do motor: é por ela
que o falso positivo bloqueante entra. Duas vezes é padrão. Uma terceira
aplicação desconhecida que a derrube por causa nova é evidência de que o
problema é a regra, e não a lacuna de normalização da vez — e nesse caso o
caminho é severidade condicionada ao que mudou dentro da URL, não ao fato de o
atributo ser `href`.

## 10. Segundo corpus — django-oscar (2026-08-13)

Este é o item que a §7 pedia: **um segundo corpus, de outra aplicação**, com
duas builds e defeito conhecido. Os adendos §8 e §9 mediam só piso de ruído.

### 10.1 Aplicação

Sandbox do [django-oscar](https://github.com/django-oscar/django-oscar) 4.2,
rodando local: e-commerce Python/Django renderizado no servidor, 201 produtos,
140 imagens, dez rotas públicas na jornada, token CSRF em todo formulário.

Estranha em todas as dimensões que importam: não a escrevemos, nada foi
calibrado contra ela, e os defeitos históricos vêm de commits de terceiros
escritos anos antes deste motor existir.

Uma propriedade a mais, e é a que torna este corpus mais duro que o primeiro:
**não há passo de build**. Django lê o template a cada request, então `base` e
`head` diferem exclusivamente pelos sete defeitos. Em `juventude`, parte
relevante do ruído era do bundler (hash de conteúdo, identificador de build) e
podia ser normalizada como ruído estrutural. Aqui não existe esse escape: todo
delta ou vem de um defeito, ou é ruído do próprio motor.

### 10.2 Piso de ruído, e o que ele custou

Duas capturas da mesma build: **104 deltas, 0 bloqueantes**. Nenhum falso
positivo bloqueante — a regra `href`/`action` → HIGH sobreviveu à terceira stack
desconhecida, e ao CSRF, que era o veneno esperado.

Mas 95 dos 104 eram o `value` do `csrfmiddlewaretoken`, um por formulário em
nove páginas. Ruído que não bloqueia não derruba o gate; afoga o relatório de
triagem. Num app com formulário em toda página, um defeito real entraria numa
lista onde 91% das linhas são token — e nenhuma medição de triagem seria
possível. Fechado em `NORM-DOM-006`, com conjunção de três condições (é o
`value`, o `name` do campo é de token conhecido de framework, e o valor tem
forma opaca). Piso final: **9 deltas, 0 bloqueantes** — os 9 são o corpo de
HTML, a mesma lacuna declarada na §8 e na §9.

Terceira aplicação desconhecida, terceiro achado de normalização. As três vezes
a causa foi identidade de sessão ou token; as três vezes o conserto foi fechar a
lacuna, não mexer em severidade.

### 10.3 Os defeitos e o resultado

Sete, declarados em `packages/diff-engine/__corpus__/oscar/faults.mjs`:

| Origem | Quantos | O que significa |
|---|---|---|
| `HISTORICO` | 3 | Esteve em produção **no django-oscar** e foi corrigido por commit real do projeto (`c1951d58d`, `27fe44a17`, `e6496c7e6`), reconstituído no HEAD pela transformação inversa |
| `INJETADO` | 4 | Plantado por nós, espelhando as classes do corpus `juventude`: rota quebrada no menu, destino de formulário trocado, off-by-one em listagem, atributo perdido |

**Dois candidatos foram descartados depois de medidos**, e o registro fica
porque a diferença entre "descartei porque não detecta" e "descartei porque não
se manifesta" é a diferença entre número honesto e número fabricado: o preço sem
imposto (no sandbox o imposto é zero, os dois valores são idênticos e a troca não
muda nada na página) e o botão "voltar" da página de produto (só renderiza com
referrer).

| | Resultado |
|---|---|
| Deltas totais | 289 (DOM 244 · rede 12 · visual 33) |
| Deltas de ruído | **10** |
| Precisão na triagem | **96,5%** |
| Defeitos visíveis | **7 de 7** |
| Defeitos bloqueados | **4 de 7** |
| Falso positivo bloqueante | **0%** |

Os 10 deltas de ruído são corpos de resposta HTML, que o relatório guarda
elididos: não dá para confirmar que a marca do defeito está lá dentro, então
contam contra o motor. É a mesma lacuna da §8.

**O recall de 9,3% no recorte bloqueante não é um número sobre qualidade.** Ele
mede deltas, e um único defeito produz muitos — as 210 perdas de `alt` são um
defeito só. A unidade do critério é defeito distinto.

### 10.3.1 Um ambiente pela metade fabricou um mecanismo plausível e falso

A primeira rodada desta medição foi feita com o sandbox montado **sem compilar
os assets** (`npm run build`, que o `make sandbox` do django-oscar faz e a
receita inicial aqui não fazia). `styles.css` respondia 404 e as páginas
renderizavam sem CSS. O servidor devolvia 200 em tudo, a jornada convergia, nada
denunciava o problema — foi o log do servidor, lido por outro motivo, que o
revelou.

O efeito sobre o número não foi ruído aleatório, que é o que se esperaria. Foi
**um mecanismo coerente e falso**:

| | Sem assets | Com assets |
|---|---|---|
| Deltas totais | 708 | **289** |
| Deltas visuais | 452 | **33** |
| Páginas com altura alterada | 7 de 10 | **nenhuma** |
| Precisão na triagem | 98,6% | **96,5%** |
| Defeitos bloqueados | 4 de 7 | **4 de 7** |

Sem CSS, nada fixa a dimensão da miniatura, então imagem ainda não pintada
renderiza o texto do `alt` e ocupa espaço. Remover o `alt` mudava a altura de
toda página com listagem de produto. O efeito era real, reprodutível, e foi
confirmado com o defeito aplicado **isolado** (`/en-gb/offers/`: 10737 → 10755
px, medida idêntica à do conjunto completo). Passou no teste de evidência que
este corpus exige antes de atribuir delta visual a um defeito — e estava errado
assim mesmo, porque o ambiente é que estava errado.

Com os assets compilados a miniatura tem dimensão fixa: nenhuma altura muda, os
452 deltas visuais viram 33, e todos eles caem nas quatro páginas que têm `O2`
ou `O6`. Os 132 deltas visuais de `/en-gb/offers/` eram artefato de ambiente.

Duas coisas a levar: a exigência de medir antes de atribuir **funcionou** — sem
ela a atribuição teria sido por proximidade e ninguém saberia de nada. E
**medição só vale contra ambiente montado direito**: um sandbox pela metade não
produz barulho evidente, produz explicação plausível. As conclusões por defeito
sobreviveram intactas às duas rodadas; as conclusões por delta não. É mais uma
razão para a unidade do critério ser defeito.

### 10.4 O que passou, e a comparação com o primeiro corpus

Três defeitos aparecem na triagem e não bloqueiam:

| Defeito | Classificação | Por que não bloqueia |
|---|---|---|
| `O2-categorias-empilhadas` | `class` mudou, LOW | Troca de classe CSS. O motor vê `flex-column` sair, não "a lista transbordou o cartão" |
| `O3-busca-oculta-none` | `value` mudou, MEDIUM | Campo escondido passa a submeter a string `None` |
| `O7-miniatura-sem-alt` | `alt` removido, LOW | Atributo perdido em imagem |

**Os dois corpora falham na mesma junta.** Em `juventude` foi `F7-email-sem-required`
(atributo `required` perdido, MEDIUM, passou); aqui são `O3` e `O7`. É sempre
mudança de atributo com consequência comportamental que o motor não tem como
inferir da mudança em si. Dois corpora independentes apontando para o mesmo
lugar é evidência de verdade, não coincidência — e diz onde investir: severidade
por **consequência do atributo**, não por nome dele.

A taxa é praticamente a mesma nos dois: 5 de 9 (56%) em `juventude`, 4 de 7
(57%) aqui. O critério de saída pede ≥ 5 defeitos bloqueados, e este corpus tem
só 7 no total — 4 não atinge o número absoluto, e não deveria: um corpus de 7
defeitos não foi construído para atestar um limiar calibrado contra um de 9.

### 10.5 O que este corpus estabelece

**A regra `href`/`action` → HIGH está vindicada.** Ela era o ponto de
concentração de risco identificado na §9, e aqui, pela primeira vez, foi testada
numa aplicação estranha **com defeito de verdade** em vez de só piso de ruído.
Resultado: bloqueou 2 dos 4 defeitos bloqueados (`O4`, rota do menu quebrada, e
`O5`, formulário de busca submetendo para o lugar errado) e produziu **zero
falso positivo**, inclusive convivendo com CSRF em todo formulário. As duas
regras que fecharam a Fase 0 deixaram de ser hipóteses calibradas contra uma
aplicação só.

**O que ele NÃO estabelece:**

- **Não tem corpus de mudança intencional.** O par `pr-antes` × `base` do
  `juventude` mede falso positivo contra PR legítimo; aqui não existe
  equivalente, e o piso de ruído não substitui — mesma build não é PR. Enquanto
  isso faltar, o número de falso positivo desta aplicação vale só para o
  conjunto de defeitos que aplicamos.
- **Três dos sete defeitos foram desenhados espelhando o primeiro corpus**, o
  que os torna menos independentes do que a contagem sugere.
- **Camadas não validadas continuam as mesmas:** console, banco e trace.
- **A camada visual quase não foi exercitada aqui.** São 33 deltas, todos nas
  quatro páginas de listagem. O corpus mede sobretudo DOM.
- **O oráculo continua sendo O5.** Defeito que já existia na base é invisível
  por construção — inclusive defeitos reais do django-oscar que estejam em
  produção agora.

## 11. Reproduzir

```bash
# 1. duas cópias descartáveis da aplicação; aplicar os defeitos numa delas
node packages/diff-engine/__corpus__/juventude/apply-faults.mjs <cópia-head>

# 2. build e serve de cada cópia (portas distintas), depois capturar as duas
node shims/cli/dist/main.js capture --url http://localhost:3101 \
  --journey apps/runner/__fixtures__/journeys/juventude.json \
  --out .aletheia/fase0/base --label base --seed 42

# 3. comparar, rotular e medir
node shims/cli/dist/main.js diff --base .aletheia/fase0/base/capture.json \
  --head .aletheia/fase0/head/capture.json --out .aletheia/fase0/relatorio
node packages/diff-engine/__corpus__/juventude/label.mjs \
  .aletheia/fase0/relatorio/report.json .aletheia/fase0/relatorio/labels.json
node shims/cli/dist/main.js measure --report .aletheia/fase0/relatorio/report.json \
  --labels .aletheia/fase0/relatorio/labels.json
```

Segundo corpus, django-oscar (§10). Monta o sandbox uma vez:

```bash
git clone https://github.com/django-oscar/django-oscar.git oscar && cd oscar
python -m venv venv --upgrade-deps
./venv/Scripts/python.exe -m pip install -e . \
  django-environ whitenoise sorl-thumbnail easy-thumbnails Whoosh pycountry
./venv/Scripts/python.exe sandbox/manage.py migrate
./venv/Scripts/python.exe sandbox/manage.py loaddata sandbox/fixtures/auth.json \
  sandbox/fixtures/child_products.json
./venv/Scripts/python.exe sandbox/manage.py oscar_import_catalogue sandbox/fixtures/books.*.csv
./venv/Scripts/python.exe sandbox/manage.py oscar_import_catalogue_images sandbox/fixtures/images.tar.gz
./venv/Scripts/python.exe sandbox/manage.py oscar_populate_countries --initial-only
./venv/Scripts/python.exe sandbox/manage.py loaddata sandbox/fixtures/pages.json \
  sandbox/fixtures/ranges.json sandbox/fixtures/offers.json
./venv/Scripts/python.exe sandbox/manage.py update_index catalogue
# OS DOIS PASSOS ABAIXO NÃO SÃO OPCIONAIS — ver §10.3.1. Sem eles o CSS responde
# 404, a aplicação renderiza sem estilo, e a camada visual mede outra coisa.
npm install && npm run build
cp src/oscar/static/oscar/img/image_not_found.jpg sandbox/public/media/
./venv/Scripts/python.exe sandbox/manage.py collectstatic --noinput
./venv/Scripts/python.exe sandbox/manage.py runserver 3201 --noreload --insecure
```

Confira antes de capturar — a aplicação responde 200 mesmo sem os assets, então
este é o único sinal barato de que o ambiente está inteiro:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3201/static/oscar/css/styles.css
# 200 esperado; 404 significa que os assets não foram compilados
```

Depois, capturar as duas builds. Django recarrega template a quente, então não
há passo de build entre aplicar o defeito e observar:

```bash
J=apps/runner/__fixtures__/journeys/oscar.json
node shims/cli/dist/main.js capture --url http://127.0.0.1:3201 --journey $J \
  --out .aletheia/oscar/base --label base --seed 42
node packages/diff-engine/__corpus__/oscar/apply-faults.mjs <clone do oscar>
node shims/cli/dist/main.js capture --url http://127.0.0.1:3201 --journey $J \
  --out .aletheia/oscar/head --label head --seed 42
node shims/cli/dist/main.js diff --base .aletheia/oscar/base/capture.json \
  --head .aletheia/oscar/head/capture.json --out .aletheia/oscar/relatorio \
  --env oscar-sandbox --confidence-mode ISOLATED
node packages/diff-engine/__corpus__/oscar/label.mjs \
  .aletheia/oscar/relatorio/report.json .aletheia/oscar/relatorio/labels.json
node shims/cli/dist/main.js measure --report .aletheia/oscar/relatorio/report.json \
  --labels .aletheia/oscar/relatorio/labels.json
# desfazer: git checkout -- src/  no clone do oscar
```

Piso de ruído contra stack desconhecida (§8, §9) — duas capturas da mesma build,
sem build nem login, dois minutos:

```bash
for r in a b; do
  node shims/cli/dist/main.js capture --url https://parabank.parasoft.com \
    --journey apps/runner/__fixtures__/journeys/parabank.json \
    --out .aletheia/parabank/run-$r --seed 42
done
node shims/cli/dist/main.js diff --base .aletheia/parabank/run-a/capture.json \
  --head .aletheia/parabank/run-b/capture.json --out .aletheia/parabank/ruido \
  --env parabank-hosted --confidence-mode SHARED_DEGRADED
```

Esperado: 2 deltas, nenhum bloqueante. Qualquer delta `REGRESSION` aqui é falso
positivo em cima da mesma build.

As capturas e relatórios não são versionados: pesam, contêm screenshots de
página inteira e são reconstituíveis pelos comandos acima.
