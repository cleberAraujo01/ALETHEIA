import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import {
  CAPTURE_VERSION,
  type Capture,
  type ConsoleEntry,
  type JsonValue,
  type NetworkExchange,
  type Observation,
} from "@aletheia/diff-engine";
import { PlatformError, type Clock, type Logger } from "@aletheia/shared";
import { chromium, type Browser, type BrowserContext, type Page, type Response } from "playwright";

import type { Journey, JourneyObservation } from "./journey.js";
import {
  DEFAULT_QUIESCENCE,
  MUTATION_OBSERVER_SCRIPT,
  NetworkTracker,
  waitForQuiescence,
  type QuiescenceOptions,
} from "./quiescence.js";
import { serializeDomInPage } from "./serialize-dom.js";

export interface CaptureOptions {
  readonly baseUrl: string;
  readonly label: string;
  readonly commit: string | null;
  readonly journey: Journey;
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
  readonly logger: Logger;
  readonly clock: Clock;
}

export interface CaptureResult {
  readonly capture: Capture;
  readonly browserVersion: string;
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
      const observations: Observation[] = [];
      for (const step of options.journey.observations) {
        observations.push(await captureObservation(context, step, options));
      }

      return {
        browserVersion: `chromium/${browser.version()}`,
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
  const context = await browser.newContext({
    viewport: options.journey.viewport,
    // Toda fonte de variação entre duas execuções que puder ser fixada, é
    // fixada: o que sobra de divergência tende a ser sinal, não ambiente.
    deviceScaleFactor: 1,
    locale: "pt-BR",
    timezoneId: "UTC",
    colorScheme: "light",
    reducedMotion: "reduce",
  });

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

async function captureObservation(
  context: BrowserContext,
  step: JourneyObservation,
  options: CaptureOptions,
): Promise<Observation> {
  const page = await context.newPage();
  const tracker = new NetworkTracker();
  const responses: Response[] = [];
  const consoleEntries: ConsoleEntry[] = [];

  tracker.attach(page);
  page.on("console", (message) => {
    const level = message.type();
    consoleEntries.push({
      level: level === "warning" ? "warn" : level === "error" ? "error" : level === "info" ? "info" : "log",
      text: message.text().slice(0, 2000),
    });
  });
  // A troca é montada depois da convergência, não aqui: ler o corpo de uma
  // resposta que a página abandonou trava para sempre, e só depois de convergir
  // se sabe quais foram abandonadas.
  page.on("response", (response) => {
    responses.push(response);
  });

  const url = new URL(step.path, options.baseUrl).toString();

  try {
    const response = await page.goto(url, { waitUntil: "commit" });
    if (response === null) {
      throw new PlatformError("CAPTURE_UNREADABLE", {
        observationId: step.observationId,
        url,
        reason: "navegação não produziu resposta",
      });
    }

    const outcome = await waitForQuiescence(
      page,
      tracker,
      step.observationId,
      options.quiescence ?? DEFAULT_QUIESCENCE,
    );
    options.logger.info("observação convergiu", {
      observationId: step.observationId,
      url,
      rounds: outcome.rounds,
      // RN-EXE-012: tempo de convergência é métrica de primeira classe.
      convergenceMs: outcome.elapsedMs,
      undrainedResponses: outcome.undrainedResponses,
    });

    const dom = await page.evaluate(serializeDomInPage);
    const exchanges: NetworkExchange[] = [];
    for (const response of responses) {
      exchanges.push(await collectExchange(response, tracker.isUndrained(response.request())));
    }

    const screenshot = options.screenshots
      ? await captureScreenshot(page, step, options)
      : null;

    return {
      observationId: step.observationId,
      route: step.path,
      url,
      dom,
      network: exchanges,
      console: consoleEntries,
      screenshot,
    };
  } finally {
    await page.close();
  }
}

async function captureScreenshot(
  page: Page,
  step: JourneyObservation,
  options: CaptureOptions,
): Promise<Observation["screenshot"]> {
  const directory = join(options.outDir, "screenshots");
  await mkdir(directory, { recursive: true });
  const file = join(directory, `${sanitize(step.observationId)}.png`);

  const buffer = await page.screenshot({ fullPage: true, animations: "disabled" });
  await writeFile(file, buffer);

  const dimensions = readPngDimensions(buffer);
  return {
    // Caminho relativo ao diretório do arquivo de captura: o artefato precisa
    // continuar válido quando a pasta inteira for movida ou baixada do storage.
    path: relative(dirname(options.captureFilePath), file).split("\\").join("/"),
    width: dimensions.width,
    height: dimensions.height,
    masks: step.masks,
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
    durationMs:
      timing.responseEnd > 0 ? Math.round(timing.responseEnd - timing.startTime) : null,
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
