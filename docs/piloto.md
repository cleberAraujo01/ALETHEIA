# Piloto ALETHEIA — como entrar, o que acontece, o que medimos

> Roteiro de um piloto da Fase 1 (§21.3 da arquitetura): *"Detecção autônoma
> de regressão em todo Pull Request."* Este documento é o que se manda para
> um candidato. Nada aqui promete o que o motor não faz — a seção "o que fica
> de fora" é tão obrigatória quanto a seção "o que você recebe" (PA-10).

## Quem cabe

Um piloto cabe se a aplicação tem:

| Precisa de | Por quê |
|---|---|
| Repositório no GitHub | o shim de CI é o do GitHub Actions; outros provedores vêm depois (§15) |
| **Preview por PR** com URL previsível (Vercel, Netlify ou similar) | é o `head` do par; sem preview não há o que comparar antes do merge |
| Uma URL de produção (ou de homologação estável) | é a `base` do par |
| Rotas públicas, ou sessão que se possa exportar | a jornada começa por URL; área autenticada entra com sessão pronta, quando houver |

Não precisa de: banco acessível (a camada de banco é opcional, por
capability aprovada), instrumentação, nem escrever teste.

## O que você faz — três passos

1. **Gera jornada e workflow** na raiz do seu repositório. A CLI ainda não
   está publicada no npm: clona-se o ALETHEIA na tag do piloto e constrói
   uma vez (Node 22+, pnpm, ~2 min; o browser vem com o Playwright):

   ```bash
   git clone --depth 1 --branch piloto-3 https://github.com/cleberAraujo01/ALETHEIA ../aletheia
   (cd ../aletheia && pnpm install --frozen-lockfile && pnpm build && pnpm --filter @aletheia/runner exec playwright install chromium)
   node ../aletheia/shims/cli/dist/main.js init --url https://sua-producao.exemplo --aletheia-ref piloto-3
   ```

   Sai `.aletheia/jornada.json` (as rotas públicas que o browser achou) e
   `.github/workflows/aletheia.yml`. Revise a lista de rotas; apague o que não
   deve ser observado. No CI nada disso é necessário: o shim faz o checkout e
   a build sozinho.

2. **Commit na branch default.** O gatilho `deployment_status` só vale lá.

3. **Abra um PR.** O preview dispara o workflow e o comentário do ALETHEIA
   aparece no PR em cerca de um minuto (medido: 58 s a 75 s numa aplicação
   estática, 1 min 37 s numa Next.js na Vercel).

Se os previews estiverem atrás de proteção do provedor (Vercel
Authentication, por exemplo), há dois caminhos: desligar a proteção para o
projeto, ou criar o bypass de automação e gravá-lo como secret do repositório
(`--secret-header nome=VARIAVEL` no `init` escreve o workflow certo). O valor
nunca passa pelo ALETHEIA.

## O que você recebe, em todo PR

- **Um veredito determinístico** — nenhum modelo de linguagem decide nada
  (PA-01): `NO_REGRESSION_DETECTED`, `UNDETERMINED_ONLY` (divergências abaixo
  do limiar, para triagem) ou `REGRESSION_DETECTED` (bloqueia).
- **Regressões agrupadas por causa provável**: mesma camada, mesmo tipo, mesmo
  lugar estrutural, em qualquer página — 135 deltas viram 10 grupos.
- **As camadas comparadas**: DOM (estrutura, atributos, texto), rede (rotas,
  status, corpo JSON campo a campo), console, visual (com teto: nunca
  bloqueia sozinha) e banco, se declarado.
- **A seção "o que não foi validado"**, sempre. Ela diz o que a jornada não
  viu e o que o motor não compara.
- **Falha da plataforma nunca reprova o seu PR** (RN-CI-005): job verde com
  aviso. Só regressão do seu código bloqueia.

## O que fica de fora, dito antes

- **Defeito que já existe na produção**: o oráculo é diferencial; divergência
  zero não significa aplicação correta.
- **Mudança intencional**: o motor não lê o diff de código nem o requisito;
  uma seção removida de propósito aparece como regressão até alguém rotular.
- **Texto que muda de valor** (preço, total, data): é MEDIUM, não bloqueia —
  o motor não sabe se `R$ 271,84` é o valor errado ou o novo. Bloqueia quando
  o valor vem de um dado observável (JSON da própria aplicação, banco por
  capability).
- **O que a jornada não visita**: carrinho cheio, formulário enviado, área
  logada — só entram com ações escritas por quem conhece a aplicação.
- **Canvas, vídeo, iframe de terceiro**: fora do DOM, fora da comparação.

## O que medimos no piloto — e o que pedimos de volta

Durante o piloto, para cada PR, guardamos: tempo do PR ao comentário, veredito,
bloqueantes, e o que o time fez com o comentário. O que pedimos de você:

1. **Rotular** os deltas que o comentário listar como "indeterminados", quando
   quiser — `NOISE` (vai se repetir, ninguém quer ver) ou `INTENDED_CHANGE`
   (uma vez, de propósito). É o que alimenta a supressão aprendida; nenhuma
   regra é ativada sem três execuções distintas e sem uma pessoa nomeada.
2. **Um bloqueio que estava errado**, se acontecer, é o dado mais valioso que
   existe: abra uma issue com o link do PR. Falso positivo custa a confiança
   do gate e é tratado antes de qualquer outra coisa.
3. **Responder ao NPS** ao fim de 4 semanas (abaixo).

## NPS do piloto

Uma pergunta, ao fim de 4 semanas de uso, para quem revisa PRs no time:

> **De 0 a 10, quanto você recomendaria o ALETHEIA a outro time que revisa
> Pull Requests?**

E duas abertas:

> O que o comentário do ALETHEIA te fez fazer diferente num PR?
> O que ele te fez perder tempo?

NPS = % de 9–10 menos % de 0–6. O critério de saída da fase é **NPS ≥ 40** com
**3 pilotos**. O número é publicado no registro abaixo, com o tamanho da
amostra — 3 respostas não viram "40" sem dizer que são 3.

## Registro dos pilotos

Cada piloto tem uma linha aqui: aplicação, stack, provedor de preview, data
de entrada, PRs analisados, bloqueios, falsos positivos reportados, NPS. É o
que fecha ou não fecha a fase; a medição final vai para
`docs/medicao-fase-1.md`.

| Piloto | Aplicação / stack | Preview | Entrada | PRs analisados | Bloqueios | FP reportados | NPS |
|---|---|---|---|---|---|---|---|
| 1 | Associação Atlética Juventude — Next.js 15, Vercel | `deployment_status` | 2026-08-22 | 3 rodadas no PR #2 (idêntico) | 1 (rodada 2, `_rsc`; corrigido em `piloto-3`) | 0 | — (sem PR real de mudança ainda) |
| 2 | — | — | — | — | — | — | — |
| 3 | — | — | — | — | — | — | — |

O `aletheia-demo` (§11 da medição) não conta: é ambiente de validação do
próprio projeto, sem time que revise PRs.
