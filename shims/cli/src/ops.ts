import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  compileLearnedRules,
  parseCapture,
  runDiff,
  SUPPRESSION_CATALOG,
  type Capture,
  type DiffReport,
  type SuppressionRule,
} from "@aletheia/diff-engine";
import { IR_VERSION, loadJourney } from "@aletheia/ir";
import { capture as runCapture, type CaptureTrace } from "@aletheia/runner";
import { parseElementRepository, type ElementRepository } from "@aletheia/selector-engine";
import { PlatformError, systemClock, type Logger, type RunMetadata } from "@aletheia/shared";

import type { CaptureCommandArgs, DiffCommandArgs } from "./args.js";
import { readJson, writeJson } from "./io.js";
import { loadRasters } from "./rasters.js";
import { renderHtmlReport } from "./report/html.js";
import { loadSet } from "./suppress.js";

/**
 * As duas operações que a CLI compõe — capturar e diferenciar — separadas dos
 * comandos que as expõem, para que `run` (a invocação que o shim de CI faz)
 * seja exatamente "capture, capture, diff" e nada mais. Se `run` tivesse a sua
 * própria captura ou o seu próprio diff, existiriam dois caminhos para o mesmo
 * veredito, e o segundo é o que ninguém mede.
 */

export const RUNNER_VERSION = "0.0.0-fase1";

export interface CaptureOutcome {
  readonly capture: Capture;
  readonly captureFilePath: string;
  readonly browserVersion: string;
  readonly trace: CaptureTrace;
  readonly traceFilePath: string;
}

export async function performCapture(
  args: CaptureCommandArgs,
  logger: Logger,
): Promise<CaptureOutcome> {
  const journeySource = resolve(args.journey);
  const { ir: journey, migrated } = loadJourney(await readJson(journeySource), journeySource);
  const captureFilePath = resolve(args.out, "capture.json");
  const traceFilePath = resolve(args.out, "trace.json");
  const elements: ElementRepository | null =
    args.elements === null
      ? null
      : parseElementRepository(await readJson(args.elements, "IR_INVALID"), args.elements);

  logger.info("captura iniciada", {
    baseUrl: args.url,
    journey: journey.id,
    irVersion: journey.irVersion,
    // Jornada legada (lista de rotas) foi migrada na leitura — declarado, não
    // escondido: a execução diz o que interpretou (PA-12).
    migratedFromLegacy: migrated,
    steps: journey.steps.length,
    observations: journey.steps.filter((step) => step.action === "observe").length,
    label: args.label,
  });

  const result = await runCapture({
    baseUrl: args.url,
    label: args.label,
    commit: args.commit,
    journey,
    outDir: resolve(args.out),
    captureFilePath,
    seed: args.seed,
    screenshots: args.screenshots,
    headed: args.headed,
    quiescence: { deadlineMs: args.deadlineMs, quietWindowMs: 250 },
    elements,
    logger,
    clock: systemClock,
  });

  await writeJson(captureFilePath, result.capture);
  await writeJson(traceFilePath, result.trace);
  // Fila de aprovação de cura (RN-EXE-011): arquivo próprio, só quando há o
  // que aprovar. Ninguém precisa abrir o trace para saber que houve cura.
  if (result.trace.healings.length > 0) {
    await writeJson(resolve(args.out, "healing.json"), {
      _leia:
        "Curas PROPOSTAS pelo consenso multi-sinal. Nenhuma foi aplicada à jornada. " +
        "Aprovar é copiar `proposal` para o fingerprint (inline ou no repositório) depois de conferir o screenshot.",
      healings: result.trace.healings,
    });
  }

  logger.info("captura concluída", {
    captureId: result.capture.captureId,
    browserVersion: result.browserVersion,
    observations: result.capture.observations.length,
    interrupted: result.capture.interruption !== null,
    healingsProposed: result.trace.healings.length,
  });

  return {
    capture: result.capture,
    captureFilePath,
    browserVersion: result.browserVersion,
    trace: result.trace,
    traceFilePath,
  };
}

export interface DiffOutcome {
  readonly report: DiffReport;
  readonly reportPaths: readonly string[];
}

export async function performDiff(
  args: DiffCommandArgs,
  runId: string,
  logger: Logger,
  browserVersion: string | null = null,
): Promise<DiffOutcome> {
  const base = await loadCapture(args.base);
  const head = await loadCapture(args.head);

  const metadata: RunMetadata = {
    runId,
    // Componentes ainda inexistentes nesta fase — declarados, não inventados.
    worldModelVersion: null,
    irVersion: IR_VERSION,
    runnerVersion: RUNNER_VERSION,
    browserVersion,
    seed: args.seed,
    commit: args.commit,
    baseRef: args.baseRef,
    environment: args.environment,
    confidenceMode: args.confidenceMode,
    autonomyLevel: 1,
    startedAtUtc: systemClock.nowUtcIso(),
  };

  const rasters = args.visual
    ? {
        base: await loadRasters(base, args.base),
        head: await loadRasters(head, args.head),
      }
    : undefined;

  // Regras aprendidas somam-se ao catálogo do motor; não o substituem. Só as
  // ACTIVE chegam aqui, e o motor ainda vai validar a evidência de cada uma.
  const learned: readonly SuppressionRule[] =
    args.suppressions === null ? [] : compileLearnedRules(await loadSet(args.suppressions));
  const suppressionRules = [...SUPPRESSION_CATALOG, ...learned];

  logger.info("diff iniciado", {
    baseCapture: base.captureId,
    headCapture: head.captureId,
    baseObservations: base.observations.length,
    headObservations: head.observations.length,
    visualEnabled: args.visual,
    rastersLoaded: (rasters?.base.size ?? 0) + (rasters?.head.size ?? 0),
    suppressionRules: suppressionRules.length,
  });

  const report = runDiff(base, head, {
    metadata,
    suppressionRules,
    ...(rasters === undefined ? {} : { rasters }),
  });
  const reportPaths = await writeReports(report, args);

  logger.info("diff concluído", {
    verdict: report.verdict.code,
    blocking: report.verdict.blocking,
    deltas: report.summary.total,
    regressions: report.summary.byClassification.REGRESSION,
    regressionGroups: report.summary.groups.REGRESSION,
    undetermined: report.summary.byClassification.UNDETERMINED,
    noise: report.summary.byClassification.NOISE,
    normalizations: report.normalization.total,
  });

  return { report, reportPaths };
}

async function loadCapture(path: string): Promise<Capture> {
  const absolute = resolve(path);
  return parseCapture(await readJson(absolute), absolute);
}

async function writeReports(report: DiffReport, args: DiffCommandArgs): Promise<string[]> {
  const written: string[] = [];
  for (const format of args.formats) {
    const target = resolve(args.out, format === "json" ? "report.json" : "report.html");
    const content =
      format === "json" ? `${JSON.stringify(report, null, 2)}\n` : renderHtmlReport(report);
    await writeText(target, content, { format });
    written.push(target);
  }
  return written;
}

export async function writeText(
  target: string,
  content: string,
  context: Record<string, string> = {},
): Promise<void> {
  try {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  } catch (cause) {
    throw new PlatformError("REPORT_WRITE_FAILED", { path: target, ...context }, cause);
  }
}

export function renderConsoleSummary(report: DiffReport, reportPaths: readonly string[]): string {
  const lines = [
    "",
    `  veredito     ${report.verdict.code}${report.verdict.blocking ? "  (bloqueia)" : ""}`,
    `  oráculo      ${report.oracle} — teste diferencial contra a build base`,
    `  deltas       ${report.summary.total}  ·  regressões ${report.summary.byClassification.REGRESSION}  ·  indeterminados ${report.summary.byClassification.UNDETERMINED}  ·  ruído ${report.summary.byClassification.NOISE}`,
    `  grupos       ${report.summary.groups.total}  ·  de regressão ${report.summary.groups.REGRESSION}  —  um grupo é uma causa provável (mesmo tipo, mesmo lugar, qualquer página)`,
    `  camadas      DOM ${report.summary.byLayer.DOM}  ·  rede ${report.summary.byLayer.NETWORK}  ·  visual ${report.summary.byLayer.VISUAL}  ·  console ${report.summary.byLayer.CONSOLE}`,
    `  observações  ${report.coverage.observationsCompared} comparada(s)`,
    `  não validado ${report.coverage.layersNotValidated.map((gap) => gap.layer).join(", ")}`,
    `  relatórios   ${reportPaths.join("  ")}`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}
