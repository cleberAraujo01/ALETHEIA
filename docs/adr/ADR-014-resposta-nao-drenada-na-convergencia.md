# ADR-014 — Resposta não drenada não impede a convergência

**Status:** aceito
**Data:** 2026-08-11
**Contexto:** Fase 0, medição de saída contra o corpus real `juventude`

## Problema

A convergência do runner (ADR-012) considerava a rede em silêncio quando não
havia requisição pendente, e "pendente" queria dizer *sem `requestfinished`* —
isto é, corpo da resposta ainda não terminou de baixar.

Um defeito real derrubou essa definição. Um link do menu passou a apontar para
uma rota inexistente; o Next dispara o prefetch da rota, recebe **404** e
abandona o corpo sem lê-lo. O Chromium mantém a requisição em voo para sempre e
`requestfinished` nunca chega.

Consequência: **a build inteira ficava inobservável.** A captura morria com
`TIMEOUT_CONVERGENCE` em todas as sete páginas, e nenhum veredito era emitido
sobre um defeito que o motor detecta em segundos. Pior: `response.body()` na
mesma requisição também nunca retorna, então a coleta de evidência travaria
depois da convergência.

O modo de falha é o mais perigoso possível — não é um falso negativo, é a
ausência de qualquer resposta, e ela acontece exatamente quando existe defeito.

## Decisão

Separar dois estados no rastreio de rede:

- **aguardando resposta** — requisição sem status. É trabalho pendente: a
  aplicação pode mudar de estado a qualquer instante.
- **não drenada** — resposta recebida, corpo nunca concluído porque quem pediu
  desistiu de ler.

A convergência exige zero requisições aguardando resposta. Respostas não
drenadas não a impedem, e são declaradas: contadas no log de convergência, e o
corpo delas entra na evidência como `<undrained>` — mesma convenção do corpo
grande demais, que diz por que a evidência não está ali em vez de fingir que a
resposta não tinha corpo.

## O problema que isso criaria, e como foi fechado

Aceitar "resposta chegou" como silêncio abriria uma janela nova: um bundle
grande cujos cabeçalhos chegaram mas cujo corpo ainda baixa seria considerado
concluído, e a captura poderia acontecer antes do script executar.

A trava é um **sinal de progresso, não um relógio**: um contador monotônico de
eventos de rede é fotografado antes da janela de silêncio do DOM e conferido
depois. Se qualquer coisa aconteceu na rede durante a janela — inclusive um
corpo terminando de baixar — não houve convergência e o laço roda outra volta.
Corpo abandonado não gera evento nenhum; corpo em download gera.

## Alternativas rejeitadas

**Esperar um tempo fixo pelo corpo.** Viola PA-07 e erra nos dois sentidos:
espera à toa quando o corpo foi abandonado, corta cedo quando o corpo é grande.

**Ignorar requisições de prefetch por tipo de recurso.** Trocaria um problema
geral por uma regra sobre um framework específico, e prefetch é justamente onde
um link quebrado se manifesta primeiro.

**Manter o comportamento e aumentar o deadline.** Não resolve: o corpo
abandonado nunca chega, então qualquer deadline expira.

## Consequência declarada

Uma resposta não drenada tem o corpo ausente da evidência. Se o defeito estiver
no corpo de uma resposta que a aplicação abandona, não o veremos — mas hoje o
alternativo é não ver a página inteira.
