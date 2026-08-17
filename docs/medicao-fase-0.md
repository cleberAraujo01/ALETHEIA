# Medição de saída da Fase 0

**Data:** 2026-08-11
**Critério (§21.2):** detectar ≥ 5 regressões reais com < 10% de falso positivo,
sem uma única linha de teste escrita.
**Resultado:** **atingido** — 5 defeitos distintos bloqueados de 9 presentes,
0% de falso positivo no recorte bloqueante, 9 de 9 defeitos visíveis na triagem.
Um PR legítimo da mesma aplicação passou sem nenhum delta bloqueante.

Este documento existe para que o número acima possa ser contestado. Ele registra
o que foi medido, contra o quê, o que ficou de fora e o que ainda não sabemos.

> **Leia a §10.6 e a §10.9 antes de citar o "0% de falso positivo".**
> **Dois de três PRs reais legítimos medidos reprovam:** 20 deltas bloqueantes no
> oscar (§10.6) e 11 no segundo PR do próprio juventude (§10.9) — todos falso
> positivo, nenhum defeito nos pares. O "0%" que fechou a fase foi medido no
> único dos três que, por acaso, não exercita nenhuma das duas regras de
> severidade. A detecção continua valendo; a generalização de que o gate não
> reprova quem não errou, não.

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
  **Rodado em 2026-08-13 e 2026-08-14. Derrubou as duas.** "Nó com texto
  removido → HIGH" produziu 22 falso positivo bloqueante no oscar (§10.6) e 10
  no segundo PR do juventude (§10.9). `href`/`action` → HIGH sobreviveu ao
  oscar, foi declarada vindicada na §10.5, e caiu no PR seguinte do juventude:
  1 falso positivo num link reapontado para a página que substituiu a removida.
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
- **Camadas não validadas:** banco e trace. Console saiu desta lista em 2026-08-14 (§10.10).
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

**A regra `href`/`action` → HIGH parecia vindicada aqui — e não está.** A §10.9
mediu o PR seguinte do juventude e encontrou o primeiro falso positivo dela. O
parágrafo abaixo fica como estava, porque descreve corretamente o que ESTE corpus
mostrou; o que ele não podia mostrar está na §10.9. Ela era o ponto de
concentração de risco identificado na §9, e aqui, pela primeira vez, foi testada
numa aplicação estranha **com defeito de verdade** em vez de só piso de ruído.
Resultado: bloqueou 2 dos 4 defeitos bloqueados (`O4`, rota do menu quebrada, e
`O5`, formulário de busca submetendo para o lugar errado) e produziu **zero
falso positivo**, inclusive convivendo com CSRF em todo formulário.

A outra regra não teve a mesma sorte: ver §10.6.

**O que ele NÃO estabelece:**

- **Três dos sete defeitos foram desenhados espelhando o primeiro corpus**, o
  que os torna menos independentes do que a contagem sugere.
- **Camadas não validadas continuam as mesmas:** console, banco e trace.
- **A camada visual quase não foi exercitada aqui.** São 33 deltas, todos nas
  quatro páginas de listagem. O corpus mede sobretudo DOM.
- **O oráculo continua sendo O5.** Defeito que já existia na base é invisível
  por construção — inclusive defeitos reais do django-oscar que estejam em
  produção agora.

### 10.6 Mudança intencional no oscar — a regra de texto removido caiu

Este é o experimento que faltava, e o resultado é negativo.

**O que foi medido.** Quatro mudanças reais do django-oscar, mescladas entre
2020 e 2024, todas confinadas a template e visíveis na jornada. Nenhuma é
correção de bug. Reconstituídas no template atual pela transformação inversa
(`intentional.mjs`), porque dar checkout no arquivo da época arrastaria junto
tudo que mudou nele depois.

| Mudança | Commit | O que faz |
|---|---|---|
| `M1-menu-so-nivel-1` | `cbfd74234` | Menu passa a listar só categorias de primeiro nível: links com texto somem do cabeçalho de toda página |
| `M2-id-no-campo-de-busca` | `fddb6a312` | Campo de busca ganha `id="id_q"` |
| `M3-imagem-responsiva-na-galeria` | `83dda118c` | Imagens da galeria ganham `img-fluid` |
| `M4-sem-preco-nao-compra` | `1f2772c4b` | Produto sem preço mostra "Unavailable" no lugar da disponibilidade e do botão |

**Resultado: 60 deltas, 22 BLOQUEANTES. Todos os 22 são falso positivo**, porque
não há defeito nenhum neste par. Duas das quatro mudanças foram reprovadas.

Os 22 vêm de **duas** regras, e a primeira leitura deste relatório errou ao
atribuir todos a uma só. `severityOf` testa `isInteractive` **antes** de olhar
`carriesText`, e `a` está em `INTERACTIVE_TAGS`.

> **A segunda leitura também errou, e o erro importa mais.** Dizer que os 20
> "vêm de `isInteractive`" descreve qual `if` dispara primeiro, não o que os
> causa. Os 20 deltas são, todos, **interativos E com texto perdido** — as duas
> regras os marcam HIGH de forma independente. Rebaixar qualquer uma sozinha não
> muda nada. Medido e detalhado na §10.8.

- **20 deltas, do `M1` — regra "nó interativo removido → HIGH".** Os links
  `Fiction` e `Non-Fiction` somem do menu, em cada uma das dez páginas. O texto
  realmente desapareceu, e a mudança é legítima assim mesmo: nenhum sinal no DOM
  distingue "tiraram do menu de propósito" de "o menu quebrou". Esta regra é
  anterior às duas que fecharam a Fase 0;
- **2 deltas, do `M4` — regra "nó com texto removido → HIGH"**, essa sim uma das
  duas. E o caso é pior: o `<p class="availability">` foi trocado por um `<i>`
  seguido do mesmo texto, um nível acima. **Nada desapareceu para o usuário** —
  o conteúdo mudou de invólucro, e o motor bloqueou uma reembalagem.

A distinção importa para saber o que consertar: a regra que a Fase 0 estreou
respondia por 2 dos 22, não pelos 22.

**O que foi bem**, e vale registrar porque era risco declarado: `M2` acrescenta
um `id`, que está na lista de atributos de identidade do motor, e o alinhamento
**segurou** — virou um `DOM_ATTRIBUTE_ADDED` LOW por página, não o par
"sumiu um nó, apareceu outro" que se temia. `M3` saiu como dois `class`
acrescentados e dois deltas visuais, todos LOW. E a regra `href`/`action` não
produziu um único falso positivo aqui, coerente com a §10.5.

**Por que isto não apareceu no primeiro corpus.** O PR real do `juventude` tem
68 deltas e nenhum bloqueante — mas ele não remove nó com texto. A regra nunca
tinha sido exercitada contra remoção legítima. Não foi sorte no sentido de
descuido: foi o limite declarado na §7 se realizando exatamente como previsto,
e é para isso que o segundo corpus existe.

**O que NÃO fazer.** Rebaixar a severidade de nó removido resolveria os 22 e
custaria detecção real: é essa regra que bloqueia `O6-listagem-off-by-one` aqui
e `F9-turmas-off-by-one` no `juventude` — produto e turma sumindo em silêncio de
uma listagem, que é a regressão que passa por todo teste de fluxo. Falso
negativo é pior que falso positivo (PA-10), e trocar um pelo outro não é
conserto.

**Direções, todas hipóteses e nenhuma medida ainda:**

1. **Separar remoção de reembalagem.** O caso `M4` não deveria nem existir como
   remoção: o texto continua na página, um nível acima. Um alinhamento que
   procurasse o texto do nó removido na vizinhança do head resolveria os 2
   deltas sem tocar em severidade nenhuma — e é a única direção que não tem
   trade-off aparente contra detecção. Começar por aqui.
2. **Distinguir remoção de item em listagem de remoção de item em navegação.**
   `O6` remove um `li` de uma lista de produtos; `M1` remove `a` de um menu. Há
   sinal estrutural (papel de acessibilidade, contêiner) que talvez separe os
   dois — mas talvez seja só coincidência deste par de aplicações, e uma regra
   desenhada sobre ele repetiria o erro que a §7 aponta.
3. **Supressão aprendida** (`packages/suppress/`), que a arquitetura já prevê e
   que exige ≥ 3 casos reais rotulados como `NOISE`. É o caminho certo para
   "nesta aplicação, mexer no menu é rotina" — mas é por aplicação, não fecha o
   problema geral, e não deve ser usado para varrer o caso `M4` para baixo do
   tapete.

### 10.7 Direção 1 implementada — reembalagem deixou de bloquear

Feita, medida, e é a única das três que não tem trade-off contra detecção.

Ao emitir `DOM_NODE_REMOVED`, o motor agora também responde: **o texto do nó
removido continua no mesmo pai alinhado, no head?** Se continua, é reembalagem —
`textPreserved: true` —, e a severidade cai para MEDIUM: aparece na triagem, não
reprova ninguém.

Duas contenções que mantêm a regra honesta, e as duas estão travadas em teste:

- **a comparação é de texto COMPLETO, não de trecho.** O `<li>` que o defeito
  `O6` remove tem o título do produto no meio; os irmãos compartilham "£8.99 In
  stock Add to basket". Por trecho, qualquer irmão casaria e o defeito sumiria —
  falso negativo criado para curar falso positivo, o pior negócio possível aqui;
- **o escopo é o pai alinhado, não a página.** Texto que reaparece do outro lado
  da página não é reembalagem; é outra coisa, e não temos evidência sobre o quê.

| Corpus | Antes | Depois |
|---|---|---|
| **Oscar, mudança intencional** | 60 deltas, **22 bloqueantes** | 60 deltas, **20 bloqueantes** |
| Oscar, 7 defeitos | 26 regressões · 4 de 7 bloqueados · 96,5% triagem | **idêntico** |
| Oscar, mesma build | 10 · 0 bloqueantes | idêntico |
| Juventude, PR real | 68 · 0 bloqueantes | idêntico |
| Juventude, 9 defeitos | 48 regressões · 5 de 9 bloqueados · 77,6% triagem | **idêntico** |
| Juventude, mesma build | 0 | 0 |
| ParaBank / ANBIMA, mesma build | 2 / 1 · 0 bloqueantes | idêntico |

Custou zero em detecção nos dois corpora de defeito e removeu 2 falso positivo.

**Os 20 continuam, e são o problema difícil.** Vêm da regra de nó interativo
removido, não da de texto. Rebaixá-la significa que um botão de compra que some
deixa de reprovar — e nem `juventude` nem `oscar` têm defeito que dependa dela
hoje, o que é ausência de evidência, não evidência de ausência. As direções 2 e 3
continuam abertas e nenhuma delas é obviamente certa. Enquanto isso, o número a
citar é este: **o motor reprova 1 em cada 2 mudanças legítimas que mexem no menu
desta aplicação.**

### 10.8 Ablação — o que cada regra de remoção realmente ganha

A §10.6 e a §10.7 discutiram qual regra "consertar" sem saber o que cada uma
paga. Esta seção mede, e o resultado muda a conversa.

**Método.** Interruptor temporário em `severityOf`, uma variante por vez, contra
os **quatro pares reais**. A unidade é defeito distinto bloqueado, não delta.

| Variante | juventude: defeitos | juventude: PR | oscar: defeitos | oscar: intencional |
|---|---|---|---|---|
| baseline | **5 de 9** (48 deltas) | 0 FP | **4 de 7** (26) | **20 FP** |
| sem `isInteractive` | 5 de 9 (48) | 0 FP | 4 de 7 (26) | 20 FP |
| sem `carriesText` | 2 de 9 (37) | 0 FP | 3 de 7 (22) | 20 FP |
| sem as duas | 2 de 9 (37) | 0 FP | 3 de 7 (22) | **0 FP** |

Três leituras:

**1. `isInteractive` em `DOM_NODE_REMOVED` não ganhava nada.** Retirá-la inteira
deixa detecção idêntica nos dois corpora — mesmos defeitos, mesmos deltas. Era
redundante com `carriesText` em **100%** dos casos, porque link e botão quase
sempre carregam texto.

**2. `carriesText` ganha muito.** Sem ela, o juventude cai de 5 para 2 defeitos e
o oscar de 4 para 3. É a regra que sustenta `F9` e `O6` — item sumindo em
silêncio de listagem.

**3. Os 20 só somem retirando as duas, ao custo de 4 defeitos.** Isso prova, com
número, o que a §10.6 só suspeitava: **nenhuma mexida em severidade resolve os 20
sem criar falso negativo.** Trocar 4 defeitos por 20 falso positivo é
exatamente a troca que PA-10 proíbe.

**O que foi feito com isso.** A condição de interativo foi **estreitada**, não
removida: passa a valer só para elemento interativo **sem texto** — botão de
ícone, controle rotulado apenas por `aria-label`. É a única classe que ela cobre
sozinha, nenhum dos dois corpora tem um caso dela, e o custo medido do
estreitamento é **zero** em todos os oito pares. Remover de vez seria confundir
"custo zero" com "valor zero"; um botão de comprar que é só um ícone continua
sendo regressão.

Efeito colateral que veio de graça: reembalagem de elemento interativo passa a
não bloquear. Antes era impossível — `isInteractive` devolvia HIGH antes de
qualquer verificação de `textPreserved`.

**O que continua aberto, agora com prova.** Os 20 são um problema de **sinal**,
não de regra: "tiraram o item do menu de propósito" e "o link quebrou" produzem
evidência idêntica no DOM. Das três direções da §10.6, só a terceira sobrevive a
esta medição — **supressão aprendida**, que age depois da severidade e por isso
funciona num sinal sobredeterminado. Ela exige ≥ 3 casos reais rotulados como
`NOISE` (§6.4), é por aplicação, e não fecha o problema geral. A direção 2
(separar listagem de navegação) continua sendo hipótese que só poderia ser
calibrada contra os mesmos dados que ela explicaria — a armadilha que a §7
descreve.

## 10.9 Segundo PR real do juventude — as duas regras caem

O experimento da §10.8 fechou a pergunta "qual regra consertar" e abriu outra,
maior: **a regra de texto removido é viável como regra geral?** O corpus de
mudança intencional do juventude tinha 0 bloqueantes, mas por um motivo frágil —
aquele PR não removia nó com texto. Um caso limpo pode ser sorte.

Então fomos procurar no histórico do próprio juventude um PR legítimo que
removesse. Existe: **`910181f`, "Aprimora pagina de parceiros, adiciona BMW
Agency e remove /apoie"** (2026-08-04). Ele tira a rota `/apoie`, e com ela o
link do rodapé, além de redesenhar `/parceiros`.

Par medido: `910181f^` × `910181f`, as sete rotas da jornada existindo dos dois
lados, servidas de duas builds reais. **Zero defeito neste par.**

**Resultado: 278 deltas, 11 BLOQUEANTES, todos falso positivo.**

| Origem | Quantos | Regra |
|---|---|---|
| `<li>` "Apoie o clube" sai do rodapé, nas 7 páginas | 7 | nó com texto removido → HIGH |
| redesenho de `/parceiros` (lista de etapas, CTA, card) | 3 | nó com texto removido → HIGH |
| `href="/apoie"` → `href="/parceiros"` no CTA da home | 1 | `href` mudou → HIGH |

### O que isto derruba

**A regra `href`/`action` → HIGH não está mais vindicada.** A §10.5 a declarou
vindicada com base em zero falso positivo no oscar. Aqui ela produz o primeiro:
um link legitimamente reapontado da página removida para a que a substitui. É o
caso mais banal de manutenção que existe, e o gate reprova.

**E o placar de falso positivo contra mudança legítima passa a ser:**

| PR real | Bloqueantes | Regras implicadas |
|---|---|---|
| juventude `7755d4d` × `7aeb5c3` | 0 | — |
| juventude `910181f^` × `910181f` | **11** | texto removido, `href` |
| oscar, 4 mudanças upstream | **20** | texto removido (sobredeterminado com interativo) |

**Dois de três PRs legítimos medidos reprovam.** O "0% de falso positivo" que
fechou a Fase 0 foi medido no único dos três que, por acaso, não exercita
nenhuma das duas regras. Isso não invalida a medição de detecção — os defeitos
continuam sendo pegos —, mas invalida a generalização de que o gate não reprova
quem não errou.

### O que isto NÃO derruba

A detecção. Os dois corpora de defeito continuam em 5 de 9 e 4 de 7, com 0% de
falso positivo **no recorte de defeitos**. O motor continua vendo o que deveria
ver; o problema é o que ele vê a mais.

E não derruba a §10.8: continua valendo que nenhuma mexida em severidade resolve,
porque o mesmo `carriesText` que produz estes 10 falso positivo é o que sustenta
`F9` e `O6`.

### A leitura honesta

Remoção de conteúdo e mudança de destino são, no DOM, **indistinguíveis** entre
"o time decidiu" e "o código quebrou". O motor não tem — e por construção não
pode ter — a informação que separa as duas. É o problema do oráculo aparecendo do
lado do falso positivo: sem fonte de intenção (requisito, diff de código,
contrato), a diferença observada não carrega a resposta.

Isso empurra a solução para fora da severidade e para dentro do que a
arquitetura já prevê: **O2, intenção derivada do diff de código** (§12.1). Um
motor que enxergasse o diff do PR saberia que `/apoie` foi removida de propósito.
Não é escopo da Fase 0, e é a primeira vez que a falta dele custa um número.

## 10.10 Camada de console — a lacuna declarada que virou sinal

Até 2026-08-14 o console era **capturado e nunca comparado**. A lacuna aparecia
declarada em todo relatório ("não validado CONSOLE"), o que é honesto (PA-10) e
desperdiçado: a evidência estava no artefato, intocada.

**A medição veio antes do código.** Sobre os sete pares já existentes, contando
mensagens que aparecem no head e não na base:

| Par | Mensagens novas | Erros novos |
|---|---|---|
| juventude, 9 defeitos | 9 | **7** |
| juventude, PR real #1 | 0 | 0 |
| juventude, PR real #2 | 0 | 0 |
| oscar, 7 defeitos | 0 | 0 |
| oscar, mudança intencional | 0 | 0 |
| juventude, mesma build | 0 | 0 |
| oscar, mesma build | 0 | 0 |

**Zero em três PRs legítimos e nos dois pisos; sete erros exatamente no par que
tem defeito.** É o melhor perfil de sinal medido nesta fase, e o oposto do perfil
da remoção de nó (§10.9), onde a mesma evidência aparece nos dois lados.

A razão é estrutural, não sorte: **erro novo no console não é diferença de
forma, é a aplicação dizendo que algo falhou.** Não depende de o motor adivinhar
intenção — que é precisamente o que falta nas outras regras.

### Efeito medido

| Par | Antes | Depois |
|---|---|---|
| juventude, 9 defeitos | 223 deltas · 48 regr · triagem 77,6% | **232 · 55 · 78,4%** |
| todos os outros oito pares | — | **idênticos** |

Precisão bloqueante 100%, falso positivo 0%, critério de saída mantido.

### O que a camada NÃO fez

**Não bloqueou nenhum defeito novo.** Continua 5 de 9. Os sete erros corroboram
`F6` (rota com erro de digitação) e os dois `log` corroboram `F4` (mapa
carregando junto), e os dois já bloqueavam por outras camadas. O ganho real está
na classe de defeito que ainda não temos no corpus: **exceção de JavaScript sem
rastro no DOM nem na rede** — a página renderiza igual, a requisição não
acontece, e só o console conta. É hipótese até aparecer um caso.

### Decisões, e o que cada uma custa

**Alinhamento por (nível, texto), com contagem.** Comparar conjuntos perderia "a
mesma mensagem passou de 1 para 40 vezes", que é assinatura de laço ou retry em
cascata.

**Normalização mínima — só colapso de espaço.** A medição usou texto praticamente
exato e deu zero ruído nos cinco pares sem defeito. Normalizar mais seria apagar
sinal para resolver um problema que não se manifestou.

**A rotulagem exige confirmação de outra camada.** O texto do erro é "Failed to
load resource: 404", sem a URL — atribuí-lo a `F6` pelo texto seria inferência.
`label.mjs` só atribui um delta de console quando outra camada, na mesma
observação, já carrega a assinatura daquele defeito. É a mesma ponte usada para
pixel, pelo mesmo motivo: sem ela, qualquer mensagem viraria acerto de graça.

Antes dessa ponte, os sete erros contavam como ruído e o falso positivo
bloqueante subia para **12,7%** — o critério de saída falhava. A rotulagem
fechando para baixo funcionou exatamente como projetada.

### Limite declarado

`ConsoleEntry` não carrega origem. Não dá para distinguir erro do código do
cliente de erro de script de terceiro, como a camada de rede faz com
`thirdParty`. Um widget de terceiro que passe a logar erro vai aparecer como
regressão. Nenhum dos sete pares tem esse caso; quando tiver, quem muda é a
**captura**, não a comparação.

Com isto, `CONSOLE` sai da lista de camadas não validadas. Continuam fora
`DATABASE` (Fase 1) e `TRACE` (Fase 2).

## 10.11 Severidade por consequência do atributo — a junta comum dos dois corpora

A §10.4 já tinha notado que os dois corpora falhavam no mesmo lugar, e a §10.5
tinha nomeado o lugar: **mudança de atributo com consequência comportamental que
o motor não infere da mudança em si.** Três defeitos, dois corpora
independentes:

| Defeito | Corpus | O que muda no DOM | O que a página deixa de fazer |
|---|---|---|---|
| `F7` | juventude | `required` some do campo de e-mail | o formulário aceita envio sem remetente |
| `O3` | oscar | `value=""` vira `value="None"` | paginar o catálogo busca pela palavra "None" |
| `O7` | oscar | `alt` some da miniatura do produto | leitor de tela anuncia imagem sem nome |

Nenhum deles muda um pixel. Nenhum deles quebra uma requisição. Todos os três
apareciam na triagem — `9/9` e `7/7` no recorte amplo — e nenhum bloqueava.

### A medição veio antes do código, de novo

Mesmo procedimento da §10.10, pelo mesmo motivo: uma regra de severidade nova é
barata de escrever e cara de desfazer. Três predicados, contados sobre os
relatórios dos **oito pares** que existem hoje:

| Par | restrição removida | valor virou sentinela | nome acessível → nulo |
|---|---|---|---|
| juventude, 9 defeitos | **1** | 0 | 0 |
| oscar, 7 defeitos | 0 | **4** | **105** |
| juventude, PR real #1 | 0 | 0 | 0 |
| juventude, PR real #2 | 0 | 0 | 0 |
| oscar, mudança intencional | 0 | 0 | 0 |
| juventude, mesma build | 0 | 0 | 0 |
| oscar, mesma build | 0 | 0 | 0 |
| parabank, mesma build | 0 | 0 | 0 |
| anbima, mesma build | 0 | 0 | 0 |

E a rotulagem — que fecha para baixo e não consulta o veredito do motor —
atribui os **110 deltas casados**, sem exceção, a exatamente `F7`, `O3` e `O7`.
Nenhum ruído, nenhum delta sem defeito atribuído.

**Zero nos sete pares sem defeito.** É o perfil de sinal da camada de console
(§10.10), e o oposto do perfil da remoção de nó (§10.9). A razão é a mesma que
lá: estes predicados não perguntam se alguém quis a mudança, perguntam **o que a
página deixou de conseguir fazer** — e a resposta não depende de intenção.

> O par do PR real #1 foi conferido no relatório arquivado, não em execução
> nova: as duas capturas daquele par não estão mais em disco. Os três predicados
> se calculam do tipo e do valor do delta, que não mudaram nesta versão do
> motor, então a conferência vale — mas é releitura de artefato, não medição
> nova, e fica declarada como tal.

### O que foi implementado, e por que não é "mais uma lista de nomes"

O §8 do `CLAUDE.md` pedia severidade por **consequência**, não por nome de
atributo. As três regras respondem a uma pergunta sobre o mundo, e é a pergunta
que decide quem entra:

**1. Restrição relaxada.** `CONSTRAINT_ATTRIBUTES` responde a "sem este
atributo, o navegador deixa de barrar um envio que barrava antes?". `type` falha
nesse teste e ficou fora, apesar de validar. Só na **remoção**: um `maxlength`
que muda de valor pode estar apertando ou afrouxando, e decidir qual exigiria
comparar números que nenhum par exercita.

**2. Sentinela.** `None`, `null`, `undefined`, `NaN`, `nil`, `[object Object]` —
representações textuais de "nada" que uma linguagem produziu ao serializar um
valor ausente. Vale para **qualquer atributo**, de propósito: restringir a uma
lista de nomes seria reintroduzir exatamente o que esta mudança abandona. A
regra só dispara quando o valor **vira** sentinela; um `None` estável nos dois
lados não produz delta nenhum.

**3. Nome acessível perdido.** Aqui a distinção não é qual atributo sumiu, é **o
que sobrou**: um link que perde `aria-label` mas mantém o texto continua
anunciável; uma imagem que perde `alt` não tem para onde cair. O fato novo
`textFallback`, emitido no `DOM_ACCESSIBLE_NAME_CHANGED`, carrega essa
diferença. A severidade fica no delta de consequência — o
`DOM_ATTRIBUTE_REMOVED@alt` que a causou **continua LOW**, para o mesmo defeito
não contar duas vezes.

### Efeito medido

| Par | Antes | Depois |
|---|---|---|
| juventude, 9 defeitos | 232 deltas · 55 bloq · **5/9** · FP 0% | 232 · 56 · **6/9** · FP 0% |
| oscar, 7 defeitos | 289 deltas · 26 bloq · **4/7** · FP 0% | 289 · 135 · **6/7** · FP 0% |
| juventude, PR real #2 | 278 deltas · 11 bloq | **278 · 11 — idêntico** |
| oscar, mudança intencional | 60 deltas · 20 bloq | **60 · 20 — idêntico** |
| juventude, mesma build | 0 · 0 | **0 · 0** |
| oscar, mesma build | 10 · 0 | **10 · 0** |
| parabank, mesma build | 2 · 0 | **2 · 0** |
| anbima, mesma build | 1 · 0 | **1 · 0** |

Precisão bloqueante segue **1,000** nos dois corpora de defeito; falso positivo,
**0%**. Os 11 e os 20 falso positivo da §10.9 não se mexeram — esta mudança não
os ataca e não os piora.

**Detecção: 5/9 → 6/9 e 4/7 → 6/7.** É o primeiro ganho de detecção desde a
saída da fase, e o único até aqui que veio sem custo nenhum de falso positivo.

### O que sobra, e o que isso diz

| Ainda passa | Corpus | Por quê |
|---|---|---|
| `F1`, `F2`, `F3` | juventude | contraste e splash — são deltas visuais, e `VISUAL_SEVERITY_CEILING` os prende em MEDIUM por decisão declarada |
| `O2` | oscar | o menu empilha porque uma classe do CSS mudou; o DOM não carrega a consequência |

Os quatro que restam são todos da mesma família: **consequência puramente
visual**. O teto visual é decisão consciente (§10.5) e sair dele exige
proximidade ao diff de código — Fase 2. Nenhum deles é mais um caso de "atributo
com consequência que o motor não infere": essa junta fechou.

### Custo declarado

**Um defeito passou a produzir 105 deltas bloqueantes.** `O7` afeta toda
miniatura de toda listagem, e o relatório do oscar saltou de 26 para 135
bloqueantes sem que a contagem por defeito mudasse mais que 4/7 → 6/7. A
contagem que vale continua sendo por defeito (§3), mas quem abre o relatório vê
o volume — e agrupar deltas do mesmo defeito é trabalho que ainda não existe.

**A regra de sentinela é a mais larga das três, e o caso que pode derrubá-la já
está nomeado:** um `<select>` que use "None" como valor real de "nenhuma
seleção", idioma que aparece em formulário Django. Nenhum dos oito pares tem o
caso. Quando aparecer, o caminho é supressão aprendida (§6.4 do `CLAUDE.md`), não
mexer na severidade.

**O texto visível ficou fora.** `Desconto: None` renderizado na página é a
encarnação mais provável do mesmo defeito — e também a mais plausível como
conteúdo legítimo. Nenhum dos oito pares exercita o caso, então não há evidência
para nenhum dos dois lados, e subir a severidade do texto seria inventar.
Continua MEDIUM, visível na triagem.

**E os quatro pisos de ruído valem menos aqui do que parecem.** As três regras
só disparam quando algo MUDA entre as duas capturas; um piso compara a mesma
build consigo mesma, onde por construção nenhum atributo muda. O zero deles é
verdadeiro e continua sendo pré-requisito, mas ele testa normalização, não
severidade. **A evidência que de fato sustenta o custo zero são os três pares de
PR real** — e três PRs de duas aplicações é base estreita, do mesmo tamanho da
base que a §10.9 mostrou ser insuficiente para as regras de remoção. O
experimento que pode derrubar estas três é o mesmo de sempre: um PR legítimo, de
outra aplicação, que mexa em formulário ou em imagem.

### O corpus sintético do CI passou a cobrir as três

`__fixtures__/checkout/` ganhou um formulário com `required` e campo escondido, e
uma miniatura com `alt`. O gate de corpus sai de 11 para 14 regressões, com o
piso de ruído intacto em 0. É a rede de baixo para regras que o CI não consegue
medir contra os corpora reais.

## 10.12 Supressão aprendida — o mecanismo existe, aprendeu duas regras, e nenhuma pode ser ativada

A §10.8 fechou com uma frase: das três direções para os 20 falso positivo do
oscar, só **supressão aprendida** sobrevive à medição, porque age depois da
severidade e por isso funciona num sinal sobredeterminado. Esta seção registra
o que aconteceu quando ela foi construída e apontada para os dois PRs legítimos.
O resultado tem três partes, e a terceira é a que mais importa.

### O que foi construído

Até aqui, supressão era `packages/diff-engine/src/suppress/`: uma interface de
regra em código, um catálogo vazio de propósito e um validador que exige três
casos rotulados `NOISE` em execuções distintas. Faltava o lado **por
aplicação**, que RN-ORC-010 descreve — "delta classificado como `NOISE` alimenta
automaticamente as regras de supressão, com revisão humana". Entrou:

- **Regra declarativa, em arquivo do projeto** (`suppressions.json`), com uma
  `signature` de três campos comparados por igualdade: camada, tipo e
  **esqueleto do caminho** — o caminho de identidade com os nomes acessíveis
  apagados. `li[role=listitem "Books Fiction Non-Fiction"] > div["Browse
  store"] > a[role=link "Fiction"]` vira `li[role=listitem] > div[*] >
  a[role=link]`. O nome muda com o conteúdo; a estrutura é o que se repete de um
  PR para o outro. Não há prefixo nem curinga: alargar é decisão que ainda não
  tem caso que a peça.
- **Ciclo de vida com revisão humana:** `PROPOSED` → `ACTIVE` | `REJECTED` |
  `RETIRED`, no espírito de RN-ORC-003/004. Só `ACTIVE` suprime. Mudar de
  status exige `reviewedBy` — supressão nunca é anônima — e `ACTIVE` exige a
  mesma evidência do catálogo: **três execuções distintas**. O motor se recusa a
  rodar com `ACTIVE` que não cumpra (falha de plataforma, código 2, neutra para
  o gate). Não existe flag para forçar; se existisse, seria usada.
- **Aprendizado (`aletheia suppress propose`):** lê relatório + rótulos, agrupa
  os `NOISE` de DOM por assinatura e escreve regras `PROPOSED` com a evidência
  anexada — quem rotulou, quando, em qual execução, qual delta. **Barreira
  estrutural:** assinatura que também casa com qualquer delta rotulado
  `REGRESSION` no mesmo relatório não vira regra, vira conflito reportado. É o
  §6.4 aplicado antes de a regra existir. Só DOM: ruído de rede e visual têm
  outros instrumentos (normalização, máscara), e todo ruído de rede encontrado
  nos pisos era identidade de sessão ou token.
- **Simulação (`aletheia suppress simulate`):** "se estas regras valessem, o que
  mudaria neste relatório, a que custo?" — por regra, quantos deltas casaria,
  como o motor os classificou e como o humano os rotulou. **Detecção perdida**
  é delta bloqueado pelo motor **e** rotulado `REGRESSION` que a regra
  suprimiria; qualquer número acima de zero reprova a regra antes de ela existir.
  A bancada (`pnpm corpora:medir`) imprime essa simulação para os pares do
  corpus ao lado da tabela real.
- **`diff --suppressions <arquivo>`:** aplica as `ACTIVE`, somadas ao catálogo,
  e registra `activeRuleIds` no relatório (PA-12: sem isso, reconstituir o
  veredito exigiria adivinhar qual arquivo estava carregado).

### A rotulagem dos pares legítimos, e a decisão que ela contém

Os dois pares sem defeito não tinham rotulador — não havia o que medir neles
além de "quantos bloqueantes". Agora têm (`oscar/label-intentional.mjs`,
`juventude/label-pr2.mjs`), porque a supressão precisa de rótulo `NOISE` para
aprender, e a distinção entre `NOISE` e `INTENDED_CHANGE` é **a** decisão:

- `INTENDED_CHANGE` é "aconteceu uma vez, de propósito". Não ensina nada ao
  motor, e não deve — a próxima ocorrência da mesma evidência pode ser bug.
- `NOISE` é "isto vai se repetir e ninguém quer ver de novo". É o único rótulo
  que alimenta regra, e ao dá-lo o humano aceita **deixar de ver** o que a regra
  cobre.

| Par | Mudança | Rótulo | Por quê |
|---|---|---|---|
| oscar | `M1` — menu passa a listar só o primeiro nível (20 bloqueantes + 10 nomes de `li`) | **`NOISE`** | O menu "Browse store" é gerado da árvore de categorias do banco (`category_tree`). Item entrando e saindo dali é manutenção de catálogo nesta aplicação. **O que se aceita deixar de ver está na `note`:** um bug que apague um nível do menu produz a mesma evidência e passa. |
| oscar | `M2`, `M3`, `M4` — id no campo, classe na imagem, regra de disponibilidade | `INTENDED_CHANGE` | Feitas uma vez. Rotulá-las `NOISE` ensinaria o motor a ignorar mudança de atributo em formulário e imagem — a família das três regras da §10.11. |
| juventude | `P1` — rota `/apoie` removida: `<li>` sai do rodapé em 7 páginas, CTA reapontado (8 bloqueantes) | **`INTENDED_CHANGE`** | O rodapé é escrito à mão no código. Link sumindo dali é decisão de produto desta vez e pode ser bug na próxima — `F6-rota-quem-somos` é um link **do mesmo rodapé** apontando errado. Rotular como rotina ensinaria o motor a não olhar para onde um dos nove defeitos mora. |
| juventude | `P2` redesenho de `/parceiros` (3 bloqueantes), `P3` novo apoiador na home | `INTENDED_CHANGE` | Feitas uma vez. |
| ambos | Rede: bundle com hash, corpo RSC com `_rsc=`, corpo HTML elidido | `NOISE` de motor | Artefato de build e identidade de sessão. Achado de **normalização**, e o aprendizado ignora rede de propósito. |

As duas decisões que pesam vão em direções opostas, e as duas estão declaradas
no rotulador para serem contestadas. Se alguém discordar de qualquer uma, o
custo de virar é uma linha e uma rodada da bancada.

### O que o aprendizado produziu

```
oscar      2 regras PROPOSED
  SUP-oscar-001  DOM_NODE_REMOVED @ body#default > header > nav > div#navbarSupportedContent
                                    > ul > li[role=listitem] > div[*] > a[role=link]
                 evidência: 20 deltas em 1 execução distinta
  SUP-oscar-002  DOM_ACCESSIBLE_NAME_CHANGED @ … > ul > li[role=listitem]
                 evidência: 10 deltas em 1 execução distinta
juventude  0 regras — os 11 bloqueantes são INTENDED_CHANGE; 72 NOISE, todos fora do DOM
```

Os arquivos estão versionados em `__corpus__/<app>/suppressions.json`, com
status `PROPOSED`. Simulação sobre os pares do corpus:

| Par | Regras | Suprimiria | Bloqueantes hoje → se valessem | Detecção perdida |
|---|---|---|---|---|
| Oscar — 7 defeitos | 2 | **0** | 135 → 135 · 6 de 7 intactos | **0** |
| Oscar — mudança intencional | 2 | 30 | **20 → 0** | 0 |
| Oscar — piso, mesma build | 2 | 0 | 0 → 0 | — |
| Juventude — 9 defeitos | 0 | 0 | 56 → 56 | 0 |
| Juventude — PR real #2 | 0 | 0 | 11 → 11 | 0 |

**A leitura de cada linha:**

- **Custo zero nos defeitos do oscar, e não por sorte.** `O4` (href do link
  "Offers" quebrado) mora no **mesmo menu** que `M1` — mesmo `nav`, mesmo `ul`,
  mesmo `div["Browse store"]`. A regra não o toca porque a assinatura leva o
  **tipo**: `DOM_NODE_REMOVED` não é `DOM_ATTRIBUTE_CHANGED`. Uma regra por
  prefixo de caminho, sem tipo, teria apagado `O4` — e é por isso que o alargamento
  não entrou.
- **20 → 0 é in-sample e não prova generalização.** As regras foram aprendidas
  deste par e aplicadas a ele. O que provaria alguma coisa é um terceiro PR do
  oscar que mexa no menu — que é, não por coincidência, o que falta para ativar.
- **A tabela real não mudou em nada.** Nenhuma regra é `ACTIVE`; a
  bancada continua imprimindo 20 e 11 bloqueantes, e o PR template continua
  cobrando esses números.

### Por que nenhuma pode ser ativada — e por que isso é o resultado certo

`SUP-oscar-001` tem 20 deltas de evidência e **uma** execução. Vinte deltas do
mesmo PR são a mesma mudança vista em dez páginas: um caso, não vinte. O
validador exige três execuções distintas, e o aprendizado deduplica evidência
por `deltaId`, não por `runId` — re-diffar o mesmo par três vezes gera três
`runId` e zero evidência nova. Não há como acumular três casos sem três PRs.

O corpus tem um PR legítimo por aplicação que exercita as regras. Então: **o
mecanismo está pronto, aprendeu o que havia para aprender, e vai esperar dois
PRs do oscar que mexam no menu antes de suprimir qualquer coisa.** Isto não é o
mecanismo falhando; é a barreira de §6.4 funcionando no primeiro dia. Um sistema
que ativasse `SUP-oscar-001` hoje estaria dizendo "nesta loja, link sumindo do
menu nunca é bug" com base numa observação.

**E o placar dos 31 falso positivo fica assim:**

| Origem | Quantos | Supressão aprendida resolve? |
|---|---|---|
| oscar, `M1` | 20 | **Sim, em tese** — padrão real desta aplicação; falta evidência (2 PRs) |
| juventude, `P1` + `P2` | 11 | **Não** — mudança pretendida uma vez; suprimir seria ensinar o motor a ignorar o rodapé onde `F6` mora |

Os 11 continuam sendo o que a §10.9 disse: sem fonte de intenção, remoção
deliberada e link quebrado são indistinguíveis, e a resposta é O2 — intenção
derivada do diff de código — na Fase 2. A supressão aprendida cobre a metade do
problema que é **padrão da aplicação**; não cobre, e não deve cobrir, a metade
que é **decisão pontual**.

### O que fica declarado

- **A rotulagem `NOISE` de `M1` é uma decisão, não um fato.** Está no rotulador
  com a consequência escrita. Quem ativar `SUP-oscar-001` um dia estará
  aceitando que um bug de profundidade de menu passe.
- **O esqueleto de caminho é uma função de string.** Nome acessível que
  contenha aspas sai mais grosseiro do que o ideal — determinístico, aplicado
  igual dos dois lados, e por isso aceito.
- **Só DOM aprende.** Se um dia rede precisar, o instrumento é normalização, e
  a lista de achados dos pisos (§8, §9, §10.2) diz o mesmo.
- **Nada aqui toca severidade**, e a bancada prova: os oito pares saem
  idênticos, coluna a coluna.
- **O CI valida os arquivos de regra do corpus** (`pnpm corpus:gate`): leitura,
  ids únicos, e nenhuma `ACTIVE` sem revisor ou sem três execuções distintas.
  A mesma barreira que o motor aplica em runtime, aplicada antes do merge — regra
  ativada na marra não chega à `main`. O custo (simulação contra os pares reais)
  continua sendo `pnpm corpora:medir`, na máquina de quem calibra, porque o CI
  não tem as capturas.

## 10.13 Agrupamento por assinatura — 135 bloqueantes viram 10 grupos, e o número é conferido

A §10.11 deixou um custo declarado: `O7` afeta toda miniatura de toda listagem
e o relatório do oscar saltou para 135 bloqueantes sem que a contagem por
defeito mudasse. Quem abre o relatório vê o volume, e "agrupar deltas do mesmo
defeito é trabalho que ainda não existe". Agora existe, e esta seção registra o
que ele faz, o que ele **não** afirma, e como isso foi medido.

### O que é um grupo

Deltas com a mesma **assinatura**: camada, tipo e esqueleto de caminho — a mesma
noção que a supressão aprendida usa (§10.12), de propósito. Se um grupo do
relatório e uma regra de supressão usassem chaves diferentes, o humano rotularia
um grupo e a regra cobriria outro. Um grupo junta o `alt` removido de 68
miniaturas em 5 páginas numa linha só; não junta remoção com mudança de `href`
no mesmo lugar, porque tipo é parte da chave.

Uma exceção declarada: **a camada visual não agrupa entre observações.**
`screenshot @ 0,0 144×32` na home e no contato são a mesma coordenada, não o
mesmo elemento — e medido contra os rótulos, era o único grupo que misturava
defeitos distintos (`F5`, `F9`, `F3` em sete páginas). Pixel não tem identidade
estrutural.

**O grupo não muda nada que já valia.** Veredito, severidade e classificação de
cada delta são os mesmos; a bancada prova, coluna a coluna. O grupo é
apresentação (o HTML lista por grupo, expansível) e chave de triagem
(`groupId` em cada delta, `groups` no relatório, contagem no resumo e no
veredito: "135 delta(s) em 10 grupo(s)").

### O que um grupo afirma, e como isso é conferido

Um grupo afirma "mesma causa provável". A rotulagem humana tem a causa de
verdade — o `defect`. A distância entre os dois é medida por `assessGrouping`
(no `measure` e na bancada) e declarada, nunca escondida atrás de um número de
grupos que parece pequeno:

| Par | Bloqueantes | Grupos de regressão | Misturam defeitos | Misturam regressão com ruído | Defeitos em >1 grupo de regressão |
|---|---|---|---|---|---|
| Oscar — 7 defeitos | 135 | **10** | 0 | 0 | 1 (`O7`: 5 — uma listagem por contêiner) |
| Juventude — 9 defeitos | 56 | **27** | 0 | 0 | 3 (`F8`: 10, `F6`: 9, `F5`: 5) |
| Juventude — PR real #2 | 11 | 5 | — | — | — |
| Oscar — mudança intencional | 20 | **1** | — | — | — |

Três leituras:

- **Nenhum grupo mistura defeitos, e nenhum mistura regressão com ruído.** É o
  que permite que um humano rotule um grupo inteiro de uma vez sem apagar uma
  regressão escondida no meio dele — e é o que a supressão aprendida precisa,
  porque usa a mesma chave.
- **Defeito espalhado por vários grupos é o erro tolerável, e é honesto.** `F8`
  (dígito errado no WhatsApp) aparece em 10 links diferentes da aplicação: são
  10 lugares estruturais distintos, e o motor não tem como saber que compartilham
  a causa sem ver o diff de código. `O7` em 5: uma listagem por contêiner
  (`ol` do catálogo, três `ul` de ofertas, uma de relacionados). Juntar isso
  exigiria alargar a assinatura, e alargar sem tipo é o que teria apagado `O4`
  na §10.12.
- **O par intencional do oscar vira um grupo.** Os 20 falso positivo de `M1`
  são, para quem triage, uma linha: "links removidos do menu, 10 páginas". A
  regra `SUP-oscar-001` é exatamente esse grupo.

### O que fica declarado

- Grupo é **causa provável**, não commit provado. A unidade do critério de
  saída continua sendo o defeito rotulado (§3), e a bancada continua contando
  por defeito.
- Rede agrupa mal onde a normalização falha: os 6 `REQUEST_REMOVED` de `F6` são
  o mesmo `/quem-somos?_rsc=<token>` com token diferente por página. É o mesmo
  achado de sempre (§8, §9, §10.2) — identidade de sessão — e o lugar de
  consertar é a normalização, não o agrupamento.
- O baseline do gate de corpus não muda: nenhum número que ele compara mudou.

## 11. Reproduzir

> **Se as capturas já estiverem em disco, pule para o fim: `pnpm corpora:medir`**
> refaz diff, rotulagem e medição dos oito pares e imprime a tabela do PR
> pronta (`--antes <dir de rodada anterior>` preenche as duas colunas), e logo
> abaixo a **simulação das regras de supressão** de `__corpus__/<app>/suppressions.json`
> (§10.12) — o que elas suprimiriam em cada par e a que custo. Ele sai
> com erro se faltar captura de qualquer par, e marca a linha correspondente
> como `NÃO MEDIDO` dentro da própria tabela — pela razão da §10.3.1: ambiente
> pela metade não falha, fabrica resultado plausível.
>
> O que vem abaixo é a metade cara e insubstituível: clonar as aplicações,
> aplicar os defeitos, subir os servidores e **produzir** as capturas.

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

E, depois de capturar, confira o log do servidor: **qualquer 404 invalida a
medição**. Foi esse o sinal que denunciou o ambiente pela metade, e é mais
barato que qualquer inspeção da página.

```bash
grep -oE '" [0-9]{3} ' <log do runserver> | sort | uniq -c
# esperado: só 200 e 304. Nenhum 404, nenhum 500.
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

Corpus de mudança intencional do oscar (§10.6). A ordem importa: captura-se
`pr-depois` com o clone limpo, e só então se aplica a inversa.

```bash
node shims/cli/dist/main.js capture --url http://127.0.0.1:3201 --journey $J \
  --out .aletheia/oscar/pr-depois --label pr-depois --seed 42
node packages/diff-engine/__corpus__/oscar/apply-intentional.mjs <clone do oscar>
node shims/cli/dist/main.js capture --url http://127.0.0.1:3201 --journey $J \
  --out .aletheia/oscar/pr-antes --label pr-antes --seed 42
node shims/cli/dist/main.js diff --base .aletheia/oscar/pr-antes/capture.json \
  --head .aletheia/oscar/pr-depois/capture.json --out .aletheia/oscar/pr \
  --env oscar-sandbox --confidence-mode ISOLATED
# desfazer: git checkout -- src/  no clone do oscar
```

Não há `label`/`measure` aqui, e é de propósito: **não existe defeito neste
par**, então não há o que rotular. O número é um só — quantos deltas o motor
classificou como `REGRESSION`. Hoje são 22, e o alvo é zero.

Segundo PR real do juventude (§10.9) — o par `910181f^` × `910181f`. Duas
worktrees do repositório da aplicação, duas builds, duas portas:

```bash
git -C <repo do juventude> worktree add --detach /tmp/juv-antes 910181f^
git -C <repo do juventude> worktree add --detach /tmp/juv-depois 910181f
for d in /tmp/juv-antes /tmp/juv-depois; do (cd $d && npm install && npm run build); done
(cd /tmp/juv-antes  && npx next start -p 3301) &
(cd /tmp/juv-depois && npx next start -p 3302) &

J=apps/runner/__fixtures__/journeys/juventude.json
node shims/cli/dist/main.js capture --url http://127.0.0.1:3301 --journey $J   --out .aletheia/fase0/pr2-antes --label pr2-antes --seed 42 --commit 6f4af8b
node shims/cli/dist/main.js capture --url http://127.0.0.1:3302 --journey $J   --out .aletheia/fase0/pr2-depois --label pr2-depois --seed 42 --commit 910181f
node shims/cli/dist/main.js diff --base .aletheia/fase0/pr2-antes/capture.json   --head .aletheia/fase0/pr2-depois/capture.json --out .aletheia/fase0/pr2   --env juventude-local --confidence-mode ISOLATED
```

Esperado hoje: 278 deltas, **11 bloqueantes, todos falso positivo**. Não há
`label`/`measure` — não existe defeito neste par, então não há o que rotular.

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
