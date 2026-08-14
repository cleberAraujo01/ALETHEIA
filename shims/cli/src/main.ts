#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { parseCapture, runDiff, type Capture, type DiffReport } from "@aletheia/diff-engine";
import { capture as runCapture, parseJourney } from "@aletheia/runner";
import {
  EXIT_CODE,
  PlatformError,
  createLogger,
  isPlatformError,
  newRunId,
  systemClock,
  type Logger,
  type RunMetadata,
} from "@aletheia/shared";

import {
  parseCaptureArgs,
  parseDiffArgs,
  parseMeasureArgs,
  type CaptureCommandArgs,
  type DiffCommandArgs,
} from "./args.js";
import { measureCommand } from "./measure.js";
import { loadRasters } from "./rasters.js";
import { renderHtmlReport } from "./report/html.js";

const RUNNER_VERSION = "0.0.0-fase0";

const USAGE = `
aletheia — plataforma de engenharia de qualidade autônoma

  aletheia capture --url <baseUrl> --journey <jornada.json> [opções]
  aletheia diff    --base <captura.json> --head <captura.json> [opções]
  aletheia measure --report <report.json> --labels <rotulos.json>

\`capture\` observa uma build e produz um artefato de captura.
\`diff\` compara duas capturas (oráculo O5) e emite veredito determinístico.
\`measure\` confronta o relatório com rotulagem humana e mede precisão e recall.

Opções de capture:
  --url <baseUrl>         URL base da build a observar           (obrigatório)
  --journey <arquivo>     Jornada: rotas a visitar               (obrigatório)
  --out <diretório>       Destino da captura e screenshots       (default: .aletheia/capture)
  --label <nome>          Rótulo da build: base, head…           (default: unlabeled)
  --commit <sha>          Commit observado
  --seed <valor>          Semente determinística (semeia Math.random na página)
  --screenshots false     Não capturar imagem
  --headed                Abre o browser visível, para acompanhar a navegação
  --deadline <ms>         Deadline de convergência               (default: 15000)

Opções de diff:
  --base <arquivo>        Captura da build de referência         (obrigatório)
  --head <arquivo>        Captura da build candidata             (obrigatório)
  --out <diretório>       Destino dos relatórios                 (default: .aletheia)
  --format json,html      Formatos a emitir                      (default: json,html)
  --visual false          Não comparar screenshots
  --commit <sha>          Commit da build head
  --base-ref <ref>        Referência da build base
  --env <nome>            Nome do ambiente observado
  --confidence-mode <m>   ISOLATED | PARTITIONED | SHARED_DEGRADED
  --seed <valor>          Seed registrado no relatório
  --fail-on none          Não altera o código de saída em caso de regressão

Opções de measure:
  --report <arquivo>      report.json produzido por \`diff\`      (obrigatório)
  --labels <arquivo>      Rótulos humanos por deltaId
  --emit-labels <arquivo> Gera esqueleto de rotulagem para preencher

Códigos de saída:
  0  nenhuma regressão
  1  regressão detectada — falha real do código sob teste
  2  falha da plataforma — o shim de CI NÃO deve reprovar o PR (RN-CI-005)
`;

async function main(argv: readonly string[]): Promise<number> {
  const command = argv[0];

  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(`${USAGE}\n`);
    return EXIT_CODE.OK;
  }

  const runId = newRunId();
  const logger = createLogger({ context: { runId, orgId: null, projectId: null } });

  if (command === "capture") {
    return captureCommand(parseCaptureArgs(argv.slice(1)), runId, logger);
  }
  if (command === "diff") {
    return diffCommand(parseDiffArgs(argv.slice(1)), runId, logger);
  }
  if (command === "measure") {
    return measureCommand(parseMeasureArgs(argv.slice(1)));
  }

  throw new PlatformError("CAPTURE_INVALID", { reason: `comando desconhecido: ${command}` });
}

async function captureCommand(
  args: CaptureCommandArgs,
  runId: string,
  logger: Logger,
): Promise<number> {
  const journeySource = resolve(args.journey);
  const journey = parseJourney(await readJson(journeySource), journeySource);
  const captureFilePath = resolve(args.out, "capture.json");

  logger.info("captura iniciada", {
    baseUrl: args.url,
    journey: journey.name,
    observations: journey.observations.length,
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
    logger,
    clock: systemClock,
  });

  await writeJson(captureFilePath, result.capture);

  logger.info("captura concluída", {
    runId,
    captureId: result.capture.captureId,
    browserVersion: result.browserVersion,
    observations: result.capture.observations.length,
  });

  process.stdout.write(
    `\n  captura     ${result.capture.captureId}\n` +
      `  browser     ${result.browserVersion}\n` +
      `  observações ${result.capture.observations.length}\n` +
      `  artefato    ${captureFilePath}\n\n`,
  );

  return EXIT_CODE.OK;
}

async function diffCommand(args: DiffCommandArgs, runId: string, logger: Logger): Promise<number> {
  const base = await loadCapture(args.base);
  const head = await loadCapture(args.head);

  const metadata: RunMetadata = {
    runId,
    // Componentes ainda inexistentes nesta fase — declarados, não inventados.
    worldModelVersion: null,
    irVersion: null,
    runnerVersion: RUNNER_VERSION,
    browserVersion: null,
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

  logger.info("diff iniciado", {
    baseCapture: base.captureId,
    headCapture: head.captureId,
    baseObservations: base.observations.length,
    headObservations: head.observations.length,
    visualEnabled: args.visual,
    rastersLoaded: (rasters?.base.size ?? 0) + (rasters?.head.size ?? 0),
  });

  const report = runDiff(base, head, rasters === undefined ? { metadata } : { metadata, rasters });
  await writeReports(report, args);

  logger.info("diff concluído", {
    verdict: report.verdict.code,
    blocking: report.verdict.blocking,
    deltas: report.summary.total,
    regressions: report.summary.byClassification.REGRESSION,
    undetermined: report.summary.byClassification.UNDETERMINED,
    normalizations: report.normalization.total,
  });

  process.stdout.write(renderConsoleSummary(report, args));

  if (report.verdict.blocking && args.failOnRegression) {
    return EXIT_CODE.QUALITY_GATE_FAILED;
  }
  return EXIT_CODE.OK;
}

async function loadCapture(path: string): Promise<Capture> {
  const absolute = resolve(path);
  return parseCapture(await readJson(absolute), absolute);
}

async function readJson(absolute: string): Promise<unknown> {
  let content: string;
  try {
    content = await readFile(absolute, "utf8");
  } catch (cause) {
    throw new PlatformError("CAPTURE_UNREADABLE", { path: absolute }, cause);
  }
  try {
    return JSON.parse(content);
  } catch (cause) {
    throw new PlatformError("CAPTURE_INVALID", { path: absolute, reason: "JSON inválido" }, cause);
  }
}

async function writeJson(target: string, value: unknown): Promise<void> {
  try {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } catch (cause) {
    throw new PlatformError("REPORT_WRITE_FAILED", { path: target }, cause);
  }
}

async function writeReports(report: DiffReport, args: DiffCommandArgs): Promise<void> {
  for (const format of args.formats) {
    const target = resolve(args.out, format === "json" ? "report.json" : "report.html");
    const content =
      format === "json" ? `${JSON.stringify(report, null, 2)}\n` : renderHtmlReport(report);
    try {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    } catch (cause) {
      throw new PlatformError("REPORT_WRITE_FAILED", { path: target, format }, cause);
    }
  }
}

function renderConsoleSummary(report: DiffReport, args: DiffCommandArgs): string {
  const lines = [
    "",
    `  veredito     ${report.verdict.code}${report.verdict.blocking ? "  (bloqueia)" : ""}`,
    `  oráculo      ${report.oracle} — teste diferencial contra a build base`,
    `  deltas       ${report.summary.total}  ·  regressões ${report.summary.byClassification.REGRESSION}  ·  indeterminados ${report.summary.byClassification.UNDETERMINED}  ·  ruído ${report.summary.byClassification.NOISE}`,
    `  camadas      DOM ${report.summary.byLayer.DOM}  ·  rede ${report.summary.byLayer.NETWORK}  ·  visual ${report.summary.byLayer.VISUAL}  ·  console ${report.summary.byLayer.CONSOLE}`,
    `  observações  ${report.coverage.observationsCompared} comparada(s)`,
    `  não validado ${report.coverage.layersNotValidated.map((gap) => gap.layer).join(", ")}`,
    `  relatórios   ${args.formats.map((format) => resolve(args.out, `report.${format}`)).join("  ")}`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (isPlatformError(error)) {
    // RN-CI-005: falha nossa. Sai com 2 para que o shim reporte como neutro.
    process.stderr.write(
      `\n  falha de plataforma: ${error.code}\n${Object.entries(error.context)
        .map(([key, value]) => `    ${key}: ${String(value)}`)
        .join("\n")}\n\n`,
    );
    process.exitCode = EXIT_CODE.PLATFORM_FAILURE;
  } else {
    // Erro não previsto também é falha nossa — jamais reprovação do cliente.
    process.stderr.write(`\n  falha de plataforma não classificada: ${String(error)}\n\n`);
    process.exitCode = EXIT_CODE.PLATFORM_FAILURE;
  }
}
