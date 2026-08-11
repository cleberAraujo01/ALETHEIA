# ADR-012 — Convergência por sinais de progresso na captura

**Status:** aceito · Fase 0
**Data:** 2026-08-10
**Contexto arquitetural:** PA-07, RN-EXE-005, RN-EXE-006, RN-EXE-012; ARQUITETURA.md §12.7

## Contexto

Capturar uma página exige saber **quando** ela terminou de carregar. A resposta
idiomática do mercado é `await page.waitForTimeout(3000)`. Ela é proibida aqui
(PA-07), e não por purismo: um tempo fixo é uma aposta que falha nos dois
sentidos — cedo demais captura estado incompleto e vira flake, tarde demais
multiplica o custo de toda execução.

O produto inteiro depende de duas capturas serem comparáveis. Se a captura da
base pegou a página meio renderizada e a do head pegou pronta, o motor reporta
dezenas de divergências que não existem.

## Decisão

A captura converge por três sinais de progresso simultâneos, com deadline:

| Sinal | Como é observado |
|---|---|
| Rede ociosa | Conjunto de requisições pendentes vazio (eventos do Playwright) |
| DOM parado | `MutationObserver` injetado antes do código da página; sem mutação há `quietWindowMs` |
| Sem animação | `document.getAnimations()` sem nenhuma em `running` |

Os três são verificados em laço, porque uma mutação de DOM pode disparar
requisição nova depois que a rede já silenciou. O laço sai no instante em que
os três valem ao mesmo tempo.

O único temporizador do código é o **deadline**, e ele não sincroniza nada:
existe para que uma aplicação que nunca silencia não trave a execução. Estourá-lo
é `TIMEOUT_CONVERGENCE` (RN-EXE-006) — categoria distinta de falha funcional, e
falha de **plataforma**: não conseguimos observar, logo não temos veredito sobre
o cliente e o PR dele não pode ser reprovado.

Complementarmente, toda fonte de variação controlável é fixada no contexto do
browser: viewport, `deviceScaleFactor`, locale, timezone UTC, `colorScheme`,
`reducedMotion`, e `Math.random` semeado por um script de inicialização. O que
sobrar de divergência tende a ser sinal.

## Consequências

**Positiva** — medido contra aplicação real (7 rotas em produção): convergência
entre 435 ms e 872 ms, 1 rodada de laço em 13 das 14 observações. Um
`waitForTimeout(3000)` teria custado ~3× mais tempo e ainda assim seria menos
confiável.

**Positiva** — o tempo de convergência é registrado por observação, o que
alimenta RN-EXE-012 (degradação de convergência como regressão de performance)
sem trabalho adicional.

**Negativa** — aplicações com polling permanente (heartbeat, websocket com
keep-alive visível no DOM, carrossel infinito) nunca atingem quiescência e vão
estourar o deadline. Não há mitigação nesta fase; a saída prevista é permitir
declarar sinais a ignorar por rota, o que só deve ser feito com evidência, pela
mesma razão que uma regra de supressão exige evidência.

**Negativa aceita** — semear `Math.random` altera o comportamento da aplicação
observada. É intervenção no sujeito do experimento. Foi aceita porque a
alternativa é ruído gerado dentro da aplicação, onde nenhuma normalização
alcança, e porque o seed é registrado nos metadados (PA-12).
