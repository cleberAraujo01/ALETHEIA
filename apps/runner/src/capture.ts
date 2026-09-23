import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import {
  CAPTURE_VERSION,
  type Capture,
  type CaptureInterruption,
  type ConsoleEntry,
  type DatabaseObservation,
  type JsonValue,
  type NetworkExchange,
  type Observation,
} from "@aletheia/diff-engine";
import {
  type DatabaseProbe,
  isTargetRef,
  type IrJourney,
  type IrStep,
  type IrValue,
  type Rect,
  type Relation,
  type Target,
  type TargetSpec,
} from "@aletheia/ir";
import {
  findElement,
  proposeHeal,
  type ElementRepository,
  type HealRecord,
} from "@aletheia/selector-engine";
import { PlatformError, type Clock, type Logger } from "@aletheia/shared";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Response,
} from "playwright";

import {
  DEFAULT_QUIESCENCE,
  MUTATION_OBSERVER_SCRIPT,
  NetworkTracker,
  waitForQuiescence,
  type QuiescenceOptions,
} from "./quiescence.js";
import { redactDeep, redactString } from "./redact.js";
import { isFailure, observeFingerprint, resolveTarget } from "./resolve.js";
import { serializeDomInPage } from "./serialize-dom.js";

/**
 * Runner interpretador — E-04. Interpreta a IR (§12.1), passo a passo, numa
 * única página: o estado da aplicação atravessa os passos, que é o ponto de
 * existir ação. Não gera código; a IR é a fonte da verdade e isto é a projeção.
 *
 * O que continua igual à Fase 0, de propósito: a convergência (PA-07: nada de
 * `sleep`; sinais de progresso com deadline), a serialização de DOM, a coleta
 * de rede e console, o screenshot. Só mudou QUANDO isso acontece — em cada
 * `observe`, com o que trafegou desde a observação anterior.
 *
 * FALHA DE PASSO NÃO É FALHA DE PLATAFORMA. Alvo que sumiu, ação que a página
 * recusou: sob O5, base e head rodam a mesma IR, e "o head não chegou onde a
 * base chegou" é sinal, não ruído. Por isso um passo que falha INTERROMPE a
 * jornada e a interrupção vai para dentro da captura (`interruption`): o Diff
 * Engine declara no relatório o que não foi comparado (PA-10), e as
 * observações que faltam no head aparecem como "só na base". O que continua
 * sendo falha de plataforma: não conseguir abrir o browser, navegação sem
 * resposta, convergência estourando o deadline (RN-EXE-006).
 */

export interface CaptureOptions {
  readonly baseUrl: string;
  readonly label: string;
  readonly commit: string | null;
  readonly journey: IrJourney;
  readonly outDir: string;
  readonly captureFilePath: string;
  readonly seed: string;
  readonly screenshots: boolean;
  /**
   * Abre o browser visível. Serve para inspeção humana durante o
   * desenvolvimento — não altera nada do que é capturado nem do veredito.
   */
  readonly headed: boolean;
  readonly quiescence?: QuiescenceOptions;
  /** De onde `{ secretRef }` lê. Default: variáveis de ambiente do processo. */
  readonly secrets?: (name: string) => string | undefined;
  /**
   * Headers enviados em TODA requisição do browser, com o valor tratado como
   * segredo (PA-09): mascarado em DOM, rede, console, URL e trace, nunca
   * logado. Existe para atravessar proteção de deploy — o caso concreto é o
   * `x-vercel-protection-bypass` da Vercel (medição da Fase 1, §1.4) —, mas o
   * runner não conhece provedor: quem nomeia o header é quem invoca.
   */
  readonly secretHeaders?: Readonly<Record<string, string>>;
  /** Repositório de elementos (§12.3) para alvos `{ ref }`. Sem ele, `ref` é erro de IR. */
  readonly elements?: ElementRepository | null;
  /**
   * Acesso a banco por capability (§14). O runner NUNCA vê conexão nem SQL:
   * recebe uma função que executa uma capability aprovada por nome (PA-04). Sem
   * ela, um `observe` com sonda declarada é erro de IR.
   */
  readonly database?: DatabaseAccess | null;
  readonly logger: Logger;
  readonly clock: Clock;
}

/** O que o executor de capabilities expõe ao runner — nome e parâmetros, nada mais. */
export interface DatabaseAccess {
  execute(
    capability: string,
    params: Readonly<Record<string, string | number | boolean>>,
  ): Promise<DatabaseObservation>;
}

export interface StepTrace {
  readonly id: string;
  readonly action: IrStep["action"];
  readonly status: "ok" | "failed";
  readonly elapsedMs: number;
  /** Só em ações que convergem (todas menos `observe`). RN-EXE-012. */
  readonly convergenceMs: number | null;
  readonly rounds: number | null;
  /**
   * Sinais do fingerprint que casaram o elemento escolhido pelo consenso
   * (§12.2), unidos por `+`. É a série que calibra os pesos.
   */
  readonly resolvedBy: string | null;
  /** Pontuação do vencedor sobre a soma dos pesos declarados; 1.0 é unanimidade. */
  readonly confidence: number | null;
  /** Um sinal forte declarado falhou e o consenso resolveu mesmo assim: cura proposta. */
  readonly healed: boolean;
  /** `el_…` quando o alvo veio do repositório. */
  readonly elementRef: string | null;
  readonly url: string | null;
  readonly reason: string | null;
}

export interface CaptureTrace {
  readonly irVersion: string;
  readonly journeyId: string;
  readonly steps: readonly StepTrace[];
  readonly interruption: CaptureInterruption | null;
  /** Curas PROPOSTAS nesta execução (RN-EXE-011). Nenhuma foi aplicada à IR. */
  readonly healings: readonly HealRecord[];
}

export interface CaptureResult {
  readonly capture: Capture;
  readonly browserVersion: string;
  readonly trace: CaptureTrace;
}

/** Corpo de resposta acima disto não é guardado — a evidência vira peso morto. */
const MAX_BODY_BYTES = 262_144;

/** Tipos de recurso cujo corpo interessa comparar. */
const BODY_RESOURCE_TYPES = new Set(["xhr", "fetch", "document"]);

export async function capture(options: CaptureOptions): Promise<CaptureResult> {
  const browser = await chromium.launch({ headless: !options.headed });
  try {
    const context = await createContext(browser, options);
    try {
      const session = new JourneySession(context, options);
      const { observations, trace } = await session.run();

      return {
        browserVersion: `chromium/${browser.version()}`,
        trace,
        capture: {
          captureVersion: CAPTURE_VERSION,
          captureId: `cap_${options.label}_${options.journey.name}`,
          target: {
            label: options.label,
            baseUrl: options.baseUrl,
            commit: options.commit,
            capturedAtUtc: options.clock.nowUtcIso(),
          },
          observations,
          interruption: trace.interruption,
        },
      };
    } finally {
      await context.close();
    }
  } finally {
    // PA-06: nada de limpeza de estado da aplicação. Fechar o browser é
    // descartar o ambiente efêmero, não "arrumar" o que ficou para trás.
    await browser.close();
  }
}

async function createContext(browser: Browser, options: CaptureOptions): Promise<BrowserContext> {
  const secretHeaders = options.secretHeaders ?? {};
  const context = await browser.newContext({
    viewport: options.journey.viewport,
    // Toda fonte de variação entre duas execuções que puder ser fixada, é
    // fixada: o que sobra de divergência tende a ser sinal, não ambiente.
    deviceScaleFactor: 1,
    locale: "pt-BR",
    timezoneId: "UTC",
    colorScheme: "light",
    reducedMotion: "reduce",
    ...(Object.keys(secretHeaders).length > 0 ? { extraHTTPHeaders: secretHeaders } : {}),
  });
  // Ação do Playwright espera o elemento ficar acionável; o limite dessa espera
  // é o mesmo deadline da convergência — um só orçamento, declarado.
  context.setDefaultTimeout((options.quiescence ?? DEFAULT_QUIESCENCE).deadlineMs);

  await context.addInitScript(MUTATION_OBSERVER_SCRIPT);
  await context.addInitScript(seededRandomScript(options.seed));
  return context;
}

/**
 * Substitui `Math.random` por um gerador semeado.
 *
 * Aplicações usam aleatoriedade para id de elemento, ordem de teste A/B e
 * embaralhamento de lista. Sem semear, base e head divergem por construção e o
 * ruído nasce dentro da própria aplicação, onde nenhuma normalização alcança.
 *
 * Registrado no relatório via `seed` (PA-12): a execução é reconstituível.
 */
function seededRandomScript(seed: string): string {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `
(() => {
  let state = ${hash >>> 0} || 1;
  Math.random = () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;  state >>>= 0;
    return state / 4294967296;
  };
})();
`;
}

class JourneySession {
  readonly #context: BrowserContext;
  readonly #options: CaptureOptions;
  readonly #tracker = new NetworkTracker();
  readonly #responses: Response[] = [];
  readonly #console: ConsoleEntry[] = [];
  readonly #secrets: string[] = [];
  readonly #healings: HealRecord[] = [];
  #responsesTaken = 0;
  #consoleTaken = 0;
  #currentRoute = "";

  constructor(context: BrowserContext, options: CaptureOptions) {
    this.#context = context;
    this.#options = options;
    // O valor de um header secreto é segredo desde antes do primeiro passo:
    // qualquer eco dele (página que o reflete, URL, console) já nasce mascarado.
    this.#secrets.push(...Object.values(options.secretHeaders ?? {}));
  }

  async run(): Promise<{ observations: Observation[]; trace: CaptureTrace }> {
    const page = await this.#context.newPage();
    this.#tracker.attach(page);
    page.on("console", (message) => {
      const level = message.type();
      this.#console.push({
        level:
          level === "warning"
            ? "warn"
            : level === "error"
              ? "error"
              : level === "info"
                ? "info"
                : "log",
        text: message.text().slice(0, 2000),
      });
    });
    // A troca é montada na observação, não aqui: ler o corpo de uma resposta
    // que a página abandonou trava para sempre, e só depois de convergir se
    // sabe quais foram abandonadas.
    page.on("response", (response) => {
      this.#responses.push(response);
    });

    const observations: Observation[] = [];
    const steps: StepTrace[] = [];
    let interruption: CaptureInterruption | null = null;

    try {
      for (const [index, step] of this.#options.journey.steps.entries()) {
        const startedAt = performance.now();
        try {
          const outcome = await this.#execute(page, step);
          if (outcome.observation !== null) observations.push(outcome.observation);
          steps.push({
            id: step.id,
            action: step.action,
            status: "ok",
            elapsedMs: Math.round(performance.now() - startedAt),
            convergenceMs: outcome.convergenceMs,
            rounds: outcome.rounds,
            resolvedBy: outcome.resolution?.resolvedBy ?? null,
            confidence: outcome.resolution?.confidence ?? null,
            healed: outcome.resolution?.healed ?? false,
            elementRef: outcome.resolution?.elementRef ?? null,
            url: page.url(),
            reason: null,
          });
        } catch (error) {
          if (!(error instanceof PlatformError) || error.code !== "STEP_FAILED") throw error;
          const reason = String(error.context["reason"] ?? error.code);
          steps.push({
            id: step.id,
            action: step.action,
            status: "failed",
            elapsedMs: Math.round(performance.now() - startedAt),
            convergenceMs: null,
            rounds: null,
            resolvedBy: null,
            confidence: null,
            healed: false,
            elementRef: null,
            url: page.url(),
            reason,
          });
          interruption = {
            stepId: step.id,
            action: step.action,
            reason,
            missingObservationIds: this.#options.journey.steps
              .slice(index)
              .flatMap((rest) => (rest.action === "observe" ? [rest.observationId] : [])),
          };
          this.#options.logger.warn("jornada interrompida", {
            stepId: step.id,
            action: step.action,
            reason,
            missingObservations: interruption.missingObservationIds.length,
          });
          break;
        }
      }
    } finally {
      await page.close();
    }

    return {
      observations,
      // O trace também é artefato (trace.json, healing.json) e também cruza a
      // borda (PA-09): a URL de um passo ou o motivo de uma interrupção podem
      // ecoar um segredo que a observação já mascara.
      trace: redactDeep(
        {
          irVersion: this.#options.journey.irVersion,
          journeyId: this.#options.journey.id,
          steps,
          interruption,
          healings: this.#healings,
        },
        this.#secrets,
      ),
    };
  }

  async #execute(
    page: Page,
    step: IrStep,
  ): Promise<{
    observation: Observation | null;
    convergenceMs: number | null;
    rounds: number | null;
    resolution: ResolutionInfo | null;
  }> {
    const options = this.#options;
    switch (step.action) {
      case "navigate": {
        const url = new URL(step.path, options.baseUrl).toString();
        this.#currentRoute = step.path;
        const response = await page.goto(url, { waitUntil: "commit" });
        if (response === null) {
          throw new PlatformError("CAPTURE_UNREADABLE", {
            stepId: step.id,
            url,
            reason: "navegação não produziu resposta",
          });
        }
        const converged = await this.#converge(page, step.id);
        return { observation: null, ...converged, resolution: null };
      }
      case "click": {
        const { locator, info } = await this.#locate(page, step.id, step.target);
        await this.#act(step.id, () => locator.click());
        const converged = await this.#converge(page, step.id);
        return { observation: null, ...converged, resolution: info };
      }
      case "fill": {
        const { locator, info } = await this.#locate(page, step.id, step.target);
        const value = this.#valueOf(step.id, step.value);
        await this.#act(step.id, () => locator.fill(value));
        const converged = await this.#converge(page, step.id);
        return { observation: null, ...converged, resolution: info };
      }
      case "select": {
        const { locator, info } = await this.#locate(page, step.id, step.target);
        await this.#act(step.id, async () => {
          await locator.selectOption(step.value);
        });
        const converged = await this.#converge(page, step.id);
        return { observation: null, ...converged, resolution: info };
      }
      case "press": {
        let info: ResolutionInfo | null = null;
        if (step.target !== undefined) {
          const resolution = await this.#locate(page, step.id, step.target);
          info = resolution.info;
          await this.#act(step.id, () => resolution.locator.press(step.key));
        } else {
          await this.#act(step.id, () => page.keyboard.press(step.key));
        }
        const converged = await this.#converge(page, step.id);
        return { observation: null, ...converged, resolution: info };
      }
      case "observe": {
        // A convergência já aconteceu no passo anterior; observar é fotografar.
        const observation = await this.#observe(
          page,
          step.observationId,
          step.masks,
          step.database,
          step.relations,
          step.id,
        );
        return { observation, convergenceMs: null, rounds: null, resolution: null };
      }
    }
  }

  /**
   * Alvo → fingerprint (inline ou do repositório) → consenso → `Locator`.
   * Falha de resolução é falha do PASSO (interrompe a jornada), nunca de
   * plataforma; `ref` sem repositório ou fora dele é erro de IR (plataforma).
   */
  async #locate(
    page: Page,
    stepId: string,
    spec: TargetSpec,
  ): Promise<{ locator: Locator; info: ResolutionInfo }> {
    let target: Target;
    let elementRef: string | null = null;
    if (isTargetRef(spec)) {
      const repository = this.#options.elements ?? null;
      const entry = repository === null ? null : findElement(repository, spec.ref);
      if (entry === null) {
        throw new PlatformError("IR_INVALID", {
          stepId,
          path: spec.ref,
          reason:
            repository === null
              ? "alvo por `ref` exige repositório de elementos (--elements)"
              : `elemento ${spec.ref} não está no repositório ${repository.projectId}`,
        });
      }
      target = entry.fingerprint;
      elementRef = entry.id;
    } else {
      target = spec;
    }

    const resolution = await resolveTarget(page, target);
    if (isFailure(resolution)) {
      throw new PlatformError("STEP_FAILED", {
        stepId,
        reason:
          resolution.kind === "NOT_FOUND"
            ? `alvo não encontrado (sinais tentados: ${resolution.triedSignals.join(", ")})`
            : `alvo ambíguo: ${resolution.reason} — ${resolution.candidates.length} candidato(s): ${resolution.candidates
                .slice(0, 3)
                .map((candidate) => `${candidate.key} (${candidate.score})`)
                .join("; ")}`,
      });
    }

    const { consensus, locator } = resolution;
    const info: ResolutionInfo = {
      resolvedBy: consensus.matchedSignals.join("+"),
      confidence: consensus.confidence,
      healed: consensus.healed,
      elementRef,
    };

    if (consensus.healed) {
      // RN-EXE-011: cura registrada com evidência, nunca aplicada. A execução
      // segue com o elemento que o consenso escolheu; a IR não muda.
      const observed = await observeFingerprint(locator);
      const screenshotPath = await this.#healScreenshot(locator, stepId);
      const heal = proposeHeal({
        stepId,
        elementRef,
        declared: target,
        observed,
        consensus,
        screenshotPath,
        nowUtc: this.#options.clock.nowUtcIso(),
      });
      this.#healings.push(heal);
      this.#options.logger.warn("cura de seletor proposta", {
        stepId,
        elementRef,
        staleSignals: heal.staleSignals.join(","),
        matchedSignals: heal.matchedSignals.join(","),
        confidence: heal.confidence,
      });
    }

    return { locator, info };
  }

  async #healScreenshot(locator: Locator, stepId: string): Promise<string | null> {
    try {
      const directory = join(this.#options.outDir, "healing");
      await mkdir(directory, { recursive: true });
      const file = join(directory, `${sanitize(stepId)}.png`);
      await writeFile(file, await locator.screenshot({ animations: "disabled" }));
      return relative(dirname(this.#options.captureFilePath), file).split("\\").join("/");
    } catch {
      // Sem screenshot a proposta continua válida — só com menos evidência, e
      // o campo diz isso (null), em vez de a captura morrer por causa dela.
      return null;
    }
  }

  /** Erro do Playwright ao agir (não acionável, destacado, timeout) vira falha do passo. */
  async #act(stepId: string, action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (cause) {
      throw new PlatformError(
        "STEP_FAILED",
        { stepId, reason: `ação recusada: ${firstLine(cause)}` },
        cause,
      );
    }
  }

  #valueOf(stepId: string, value: IrValue): string {
    if (typeof value === "string") return value;
    const read = this.#options.secrets ?? ((name: string) => process.env[name]);
    const secret = read(value.secretRef);
    if (secret === undefined || secret.length === 0) {
      throw new PlatformError("CAPTURE_INVALID", {
        stepId,
        reason: `segredo ${value.secretRef} não definido no ambiente`,
      });
    }
    this.#secrets.push(secret);
    return secret;
  }

  async #converge(page: Page, stepId: string): Promise<{ convergenceMs: number; rounds: number }> {
    const outcome = await waitForQuiescence(
      page,
      this.#tracker,
      stepId,
      this.#options.quiescence ?? DEFAULT_QUIESCENCE,
    );
    this.#options.logger.info("passo convergiu", {
      stepId,
      rounds: outcome.rounds,
      // RN-EXE-012: tempo de convergência é métrica de primeira classe.
      convergenceMs: outcome.elapsedMs,
      undrainedResponses: outcome.undrainedResponses,
    });
    return { convergenceMs: outcome.elapsedMs, rounds: outcome.rounds };
  }

  async #observe(
    page: Page,
    observationId: string,
    masks: readonly Rect[],
    probes: readonly DatabaseProbe[],
    relations: readonly Relation[],
    stepId: string,
  ): Promise<Observation> {
    const dom = redactDeep(await page.evaluate(serializeDomInPage), this.#secrets);

    const exchanges: NetworkExchange[] = [];
    for (const response of this.#responses.slice(this.#responsesTaken)) {
      exchanges.push(
        redactDeep(
          await collectExchange(response, this.#tracker.isUndrained(response.request())),
          this.#secrets,
        ),
      );
    }
    this.#responsesTaken = this.#responses.length;

    const consoleEntries = this.#console
      .slice(this.#consoleTaken)
      .map((entry) => ({ ...entry, text: redactString(entry.text, this.#secrets) }));
    this.#consoleTaken = this.#console.length;

    const screenshot = this.#options.screenshots
      ? await captureScreenshot(page, observationId, masks, this.#options)
      : null;

    return {
      observationId,
      route: this.#currentRoute,
      url: redactString(page.url(), this.#secrets),
      dom,
      network: exchanges,
      console: consoleEntries,
      screenshot,
      database: await this.#probeDatabase(probes, stepId),
      // A captura só carrega a declaração; verificar é do diff, sobre o DOM
      // dos dois lados (O3). Vazio vira `null`: lacuna declarada, não lista.
      relations: relations.length > 0 ? relations.map((r) => ({ ...r })) : null,
    };
  }

  /**
   * Sondas de banco do `observe` (O6). A falha de UMA capability não derruba a
   * captura: vira `error` no resultado, e o diff a trata como delta
   * (`DB_PROBE_FAILED`) — quebrar a consulta aprovada É evidência. O que
   * derruba é sonda declarada sem acesso a banco: erro de configuração da
   * execução, plataforma.
   */
  async #probeDatabase(
    probes: readonly DatabaseProbe[],
    stepId: string,
  ): Promise<readonly DatabaseObservation[] | null> {
    if (probes.length === 0) return null;
    const access = this.#options.database ?? null;
    if (access === null) {
      throw new PlatformError("IR_INVALID", {
        stepId,
        reason:
          "observe declara sonda de banco, mas a execução não tem acesso a banco (--db / --capabilities)",
      });
    }
    const results: DatabaseObservation[] = [];
    for (const probe of probes) {
      try {
        results.push(await access.execute(probe.capability, probe.params));
      } catch (error) {
        const reason =
          error instanceof PlatformError
            ? `${error.code}: ${String(error.context["reason"] ?? "")}`
            : firstLine(error);
        this.#options.logger.warn("sonda de banco falhou", {
          stepId,
          capability: probe.capability,
          reason,
        });
        results.push({
          capability: probe.capability,
          params: probe.params,
          columns: [],
          rows: [],
          rowCount: 0,
          truncated: false,
          keyColumns: [],
          volatileColumns: [],
          maskedColumns: [],
          durationMs: 0,
          error: reason,
        });
      }
    }
    return results;
  }
}

interface ResolutionInfo {
  readonly resolvedBy: string;
  readonly confidence: number;
  readonly healed: boolean;
  readonly elementRef: string | null;
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0]?.slice(0, 300) ?? "";
}

async function captureScreenshot(
  page: Page,
  observationId: string,
  masks: readonly Rect[],
  options: CaptureOptions,
): Promise<Observation["screenshot"]> {
  const directory = join(options.outDir, "screenshots");
  await mkdir(directory, { recursive: true });
  const file = join(directory, `${sanitize(observationId)}.png`);

  const buffer = await page.screenshot({ fullPage: true, animations: "disabled" });
  await writeFile(file, buffer);

  const dimensions = readPngDimensions(buffer);
  return {
    // Caminho relativo ao diretório do arquivo de captura: o artefato precisa
    // continuar válido quando a pasta inteira for movida ou baixada do storage.
    path: relative(dirname(options.captureFilePath), file).split("\\").join("/"),
    width: dimensions.width,
    height: dimensions.height,
    masks,
  };
}

/** Lê largura e altura do chunk IHDR, evitando uma dependência de decodificação. */
function readPngDimensions(buffer: Buffer): { width: number; height: number } {
  if (buffer.length < 24 || buffer.readUInt32BE(12) !== 0x49484452) {
    throw new PlatformError("CAPTURE_INVALID", { reason: "screenshot não é um PNG válido" });
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function collectExchange(response: Response, undrained: boolean): Promise<NetworkExchange> {
  const request = response.request();
  const resourceType = request.resourceType();

  let responseBody: JsonValue | null = null;
  if (BODY_RESOURCE_TYPES.has(resourceType)) {
    // Mesma convenção do corpo grande demais: o marcador diz por que a
    // evidência não está aqui, em vez de fingir que a resposta não tinha corpo.
    responseBody = undrained ? "<undrained>" : await readBody(response);
  }

  const timing = request.timing();
  return {
    method: request.method(),
    url: request.url(),
    status: response.status(),
    resourceType,
    requestBody: parseJsonish(request.postData()),
    responseBody,
    durationMs: timing.responseEnd > 0 ? Math.round(timing.responseEnd - timing.startTime) : null,
  };
}

async function readBody(response: Response): Promise<JsonValue | null> {
  try {
    const contentType = (await response.headerValue("content-type")) ?? "";
    if (!contentType.includes("json") && !contentType.includes("text")) return null;

    const buffer = await response.body();
    if (buffer.length > MAX_BODY_BYTES) {
      return `<oversized:${buffer.length}>`;
    }
    return parseJsonish(buffer.toString("utf8"));
  } catch {
    // Redirect, resposta já descartada pelo browser, cache hit sem corpo.
    // Ausência de corpo não é falha de captura.
    return null;
  }
}

function parseJsonish(raw: string | null): JsonValue | null {
  if (raw === null || raw.length === 0) return null;
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    return raw.length > MAX_BODY_BYTES ? `<oversized:${raw.length}>` : raw;
  }
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
