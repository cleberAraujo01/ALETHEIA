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

export class NetworkTracker {
  readonly #pending = new Set<Request>();
  #idleWaiters: (() => void)[] = [];

  attach(page: Page): void {
    page.on("request", (request) => {
      this.#pending.add(request);
    });
    page.on("requestfinished", (request) => this.#settle(request));
    page.on("requestfailed", (request) => this.#settle(request));
  }

  get pendingCount(): number {
    return this.#pending.size;
  }

  /** Resolve imediatamente se não há nada pendente, senão ao esvaziar. */
  whenIdle(): Promise<void> {
    if (this.#pending.size === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.#idleWaiters.push(resolve);
    });
  }

  #settle(request: Request): void {
    this.#pending.delete(request);
    if (this.#pending.size > 0) return;
    const waiters = this.#idleWaiters;
    this.#idleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}

/** Número máximo de alternâncias rede ⇄ DOM antes de desistir. */
const MAX_ROUNDS = 8;

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
    // rede. Se ainda há pendência, roda outra volta; senão, convergiu.
    if (tracker.pendingCount === 0) {
      return { rounds: rounds + 1, elapsedMs: Math.round(performance.now() - startedAt) };
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
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new PlatformError("TIMEOUT_CONVERGENCE", {
            observationId,
            signal,
            deadlineMs: remainingMs,
          }),
        ),
      remainingMs,
    );
  });

  try {
    await Promise.race([promise, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
