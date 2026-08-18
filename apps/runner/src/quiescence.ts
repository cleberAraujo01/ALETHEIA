import { PlatformError } from "@aletheia/shared";
import type { Page, Request } from "playwright";

/**
 * Convergência determinística — PA-07 e RN-EXE-005.
 *
 * **Não existe `sleep` aqui, e não pode existir.** Esperar 3 segundos é apostar
 * que a aplicação terminou; quando a aposta falha o teste vira flake, e quando
 * sobra tempo a suíte fica lenta sem motivo. O que se faz é observar sinais de
 * progresso e sair no instante em que a aplicação parou de trabalhar:
 *
 *   - nenhuma requisição pendente (sinal de rede);
 *   - nenhuma mutação de DOM há `quietWindowMs` (sinal de renderização);
 *   - nenhuma animação em execução (sinal de transição).
 *
 * Os três precisam valer ao mesmo tempo, porque uma mutação pode disparar uma
 * requisição nova depois que a rede já tinha silenciado. Daí o laço.
 *
 * Estourar o deadline é `TIMEOUT_CONVERGENCE` (RN-EXE-006) — falha de
 * sincronização, categoria distinta de falha funcional, e falha de PLATAFORMA:
 * não conseguimos observar, então não temos veredito sobre o cliente.
 */

export interface QuiescenceOptions {
  readonly deadlineMs: number;
  /** Janela sem mutação de DOM que caracteriza "parou de renderizar". */
  readonly quietWindowMs: number;
}

export const DEFAULT_QUIESCENCE: QuiescenceOptions = {
  // HIPÓTESE: 15s cobre carregamento de SPA com chamadas encadeadas. O número
  // certo sai da distribuição de tempo de convergência real (RN-EXE-012).
  deadlineMs: 15_000,
  quietWindowMs: 250,
};

/** Script injetado antes de qualquer código da página. */
export const MUTATION_OBSERVER_SCRIPT = `
(() => {
  window.__aletheiaLastMutation = performance.now();
  const observer = new MutationObserver(() => {
    window.__aletheiaLastMutation = performance.now();
  });
  const start = () => observer.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, characterData: true,
  });
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
`;

/**
 * Rastreio de rede em dois estados, e a distinção entre eles é o que separa
 * "a aplicação ainda está trabalhando" de "a aplicação largou o corpo da
 * resposta e não vai fazer mais nada":
 *
 *   - **aguardando resposta** — a requisição saiu e o servidor ainda não
 *     respondeu. Enquanto houver uma destas, a aplicação pode mudar de estado a
 *     qualquer instante: isto é trabalho pendente de verdade.
 *   - **não drenada** — a resposta chegou (status, cabeçalhos) e o corpo nunca
 *     terminou de ser baixado, porque quem pediu desistiu de ler. O browser
 *     mantém a requisição "em voo" para sempre e `requestfinished` nunca
 *     dispara.
 *
 * O segundo estado não é hipótese: apareceu na medição contra a aplicação real
 * quando um link do menu passou a apontar para uma rota inexistente. O Next
 * dispara o prefetch, recebe 404 e abandona o corpo. Tratar isso como trabalho
 * pendente tornava a build INOBSERVÁVEL — a captura morria de
 * `TIMEOUT_CONVERGENCE` e nenhum veredito era emitido sobre um defeito que o
 * motor detectaria em segundos.
 *
 * A alternativa rejeitada foi esperar um tempo fixo pelo corpo. Além de violar
 * PA-07, ela erra nos dois sentidos: espera à toa quando o corpo foi
 * abandonado, e corta cedo quando o corpo é grande.
 */
export class NetworkTracker {
  readonly #awaitingResponse = new Set<Request>();
  readonly #undrained = new Set<Request>();
  #idleWaiters: (() => void)[] = [];

  attach(page: Page): void {
    page.on("request", (request) => {
      this.#awaitingResponse.add(request);
    });
    page.on("response", (response) => {
      this.#respond(response.request());
    });
    page.on("requestfinished", (request) => {
      this.#settle(request);
    });
    page.on("requestfailed", (request) => {
      this.#settle(request);
    });
  }

  /** Requisições sem resposta — as únicas que representam trabalho pendente. */
  get pendingCount(): number {
    return this.#awaitingResponse.size;
  }

  /** Respostas recebidas cujo corpo a página nunca leu. Evidência, não silêncio. */
  get undrainedCount(): number {
    return this.#undrained.size;
  }

  /**
   * Ler o corpo de uma resposta não drenada trava para sempre — o `body()` do
   * Playwright espera um download que ninguém vai completar. Quem coleta
   * evidência consulta isto antes de tentar.
   */
  isUndrained(request: Request): boolean {
    return this.#undrained.has(request);
  }

  /**
   * Contador monotônico de eventos de rede (resposta recebida, corpo concluído,
   * requisição falhada). É o sinal de progresso que permite distinguir corpo
   * ABANDONADO de corpo AINDA BAIXANDO sem consultar relógio: se este número
   * não se moveu durante toda a janela de silêncio do DOM, nada aconteceu na
   * rede naquele intervalo. Se moveu, houve trabalho e o laço roda outra volta.
   */
  get networkEventCount(): number {
    return this.#events;
  }

  #events = 0;

  /** Resolve imediatamente se nada aguarda resposta, senão ao esvaziar. */
  whenIdle(): Promise<void> {
    if (this.#awaitingResponse.size === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.#idleWaiters.push(resolve);
    });
  }

  #respond(request: Request): void {
    this.#events += 1;
    if (!this.#awaitingResponse.delete(request)) return;
    this.#undrained.add(request);
    this.#releaseIfIdle();
  }

  #settle(request: Request): void {
    this.#events += 1;
    this.#awaitingResponse.delete(request);
    this.#undrained.delete(request);
    this.#releaseIfIdle();
  }

  #releaseIfIdle(): void {
    if (this.#awaitingResponse.size > 0) return;
    const waiters = this.#idleWaiters;
    this.#idleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}

/**
 * Número máximo de alternâncias rede ⇄ DOM antes de desistir. HIPÓTESE, e a
 * primeira calibração veio do vite.dev (VitePress): prefetch de rotas em idle
 * produz 5–8 voltas legítimas por página, e o teto de 8 derrubava capturas
 * inteiras por "oscilação" quando faltavam dois segundos para convergir. O
 * limite que protege contra aplicação que nunca silencia é o DEADLINE; o teto
 * de voltas só precisa ser alto o bastante para não ser ele o gargalo.
 */
const MAX_ROUNDS = 24;

export async function waitForQuiescence(
  page: Page,
  tracker: NetworkTracker,
  observationId: string,
  options: QuiescenceOptions = DEFAULT_QUIESCENCE,
): Promise<QuiescenceOutcome> {
  const startedAt = performance.now();
  const deadlineAt = startedAt + options.deadlineMs;
  let rounds = 0;

  for (; rounds < MAX_ROUNDS; rounds += 1) {
    const remaining = deadlineAt - performance.now();
    if (remaining <= 0) break;

    await raceDeadline(tracker.whenIdle(), remaining, observationId, "rede");

    const domRemaining = deadlineAt - performance.now();
    if (domRemaining <= 0) break;

    // Fotografia do estado da rede ANTES da janela de silêncio do DOM. Se este
    // número mudar durante a janela, houve trabalho de rede e o silêncio do DOM
    // não significa que a página terminou — roda outra volta.
    const networkEventsBefore = tracker.networkEventCount;

    try {
      await page.waitForFunction(
        (quietWindowMs: number) => {
          const globals = window as unknown as { __aletheiaLastMutation?: number };
          const last = globals.__aletheiaLastMutation ?? 0;
          const domQuiet = performance.now() - last >= quietWindowMs;
          const animating =
            typeof document.getAnimations === "function"
              ? document.getAnimations().some((animation) => animation.playState === "running")
              : false;
          return domQuiet && !animating;
        },
        options.quietWindowMs,
        { timeout: domRemaining, polling: 50 },
      );
    } catch (cause) {
      throw new PlatformError(
        "TIMEOUT_CONVERGENCE",
        { observationId, signal: "dom", deadlineMs: options.deadlineMs },
        cause,
      );
    }

    // Uma mutação pode ter disparado requisição nova depois do silêncio de
    // rede, e um corpo ainda em download pode ter terminado (e executado)
    // durante a janela. Qualquer um dos dois derruba a convergência.
    if (tracker.pendingCount === 0 && tracker.networkEventCount === networkEventsBefore) {
      return {
        rounds: rounds + 1,
        elapsedMs: Math.round(performance.now() - startedAt),
        undrainedResponses: tracker.undrainedCount,
      };
    }
  }

  throw new PlatformError("TIMEOUT_CONVERGENCE", {
    observationId,
    signal: rounds >= MAX_ROUNDS ? "oscilação entre rede e DOM" : "deadline",
    rounds,
    deadlineMs: options.deadlineMs,
  });
}

export interface QuiescenceOutcome {
  readonly rounds: number;
  readonly elapsedMs: number;
  /**
   * Respostas cujo corpo a página abandonou. Não impedem a convergência, mas
   * são declaradas: o corpo delas não entra na evidência (PA-10).
   */
  readonly undrainedResponses: number;
}

/**
 * O timer aqui é o **deadline**, não a sincronização: quem decide o momento de
 * seguir é o sinal de progresso. O timer só existe para que uma aplicação que
 * nunca silencia não trave a execução para sempre.
 */
async function raceDeadline(
  promise: Promise<void>,
  remainingMs: number,
  observationId: string,
  signal: string,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new PlatformError("TIMEOUT_CONVERGENCE", {
          observationId,
          signal,
          deadlineMs: remainingMs,
        }),
      );
    }, remainingMs);
  });

  try {
    await Promise.race([promise, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
