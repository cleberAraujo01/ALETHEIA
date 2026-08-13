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

## 10. Reproduzir

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
