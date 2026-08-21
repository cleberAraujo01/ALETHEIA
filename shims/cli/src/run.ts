import { resolve } from "node:path";

import { EXIT_CODE, type Logger } from "@aletheia/shared";

import type { RunCommandArgs } from "./args.js";
import { performCapture, performDiff, renderConsoleSummary, writeText } from "./ops.js";
import { renderPrComment } from "./report/markdown.js";

/**
 * `aletheia run` — o contrato com os shims de CI (§15.1, §15.2).
 *
 * É "capture, capture, diff", nas mesmas funções que os comandos avulsos usam,
 * e mais nada. O shim que a chama faz três coisas: autenticar, invocar,
 * publicar (PA-11) — então tudo que o shim vai publicar já sai daqui pronto:
 *
 *   <out>/report.json    veredito canônico (fonte de tudo o mais)
 *   <out>/report.html    relatório técnico
 *   <out>/comment.md     comentário de PR, mesmos fatos, cabe numa tela
 *   <out>/summary.json   o mínimo que um shim precisa sem parsear o relatório
 *
 * Código de saída pelo contrato: 0 sem regressão, 1 regressão (reprova),
 * 2 falha de plataforma (o shim NÃO reprova — RN-CI-005). O `2` é lançado
 * como `PlatformError` e tratado no `main`; este arquivo só decide entre 0 e 1.
 */

export interface RunSummary {
  readonly runId: string;
  readonly verdict: string;
  readonly blocking: boolean;
  readonly exitCode: number;
  readonly regressions: number;
  readonly regressionGroups: number;
  readonly undetermined: number;
  readonly noise: number;
  readonly observationsCompared: number;
  readonly confidenceMode: string;
  /** Curas de seletor PROPOSTAS (RN-EXE-011) em base + head; nenhuma aplicada. */
  readonly healingsProposed: number;
  readonly report: string;
  readonly reportHtml: string;
  readonly comment: string;
}

export async function runCommand(
  args: RunCommandArgs,
  runId: string,
  logger: Logger,
): Promise<number> {
  const out = resolve(args.out);
  const journey = resolve(args.journey);

  const captureArgs = (
    label: "base" | "head",
    url: string,
    commit: string | null,
    db: string | null,
  ) => ({
    url,
    journey,
    out: resolve(out, label),
    label,
    commit,
    seed: args.seed,
    screenshots: args.screenshots,
    headed: false,
    deadlineMs: args.deadlineMs,
    elements: args.elements,
    db,
    capabilities: args.capabilities,
    dbEnvironment: args.dbEnvironment,
    dataStrategy: db === null ? null : args.dataStrategy,
    // O mesmo header vai para base e head: no caso que motiva a flag (Vercel),
    // o segredo de bypass é do projeto e vale para produção e previews.
    secretHeaders: args.secretHeaders,
  });

  // Base primeiro, sempre: se a base não capturar, o head nem é visitado — e o
  // erro que sai é de plataforma, não veredito.
  const base = await performCapture(
    captureArgs("base", args.baseUrl, args.baseRef, args.baseDb),
    logger,
    `${runId}_base`,
  );
  const head = await performCapture(
    captureArgs("head", args.headUrl, args.commit, args.headDb),
    logger,
    `${runId}_head`,
  );

  const { report, reportPaths } = await performDiff(
    {
      base: base.captureFilePath,
      head: head.captureFilePath,
      out,
      formats: ["json", "html"],
      commit: args.commit,
      baseRef: args.baseRef,
      environment: args.environment,
      confidenceMode: args.confidenceMode,
      seed: args.seed,
      failOnRegression: args.failOnRegression,
      visual: args.screenshots,
      suppressions: args.suppressions,
      dataStrategy: args.dataStrategy,
    },
    runId,
    logger,
    head.browserVersion,
  );

  const commentPath = resolve(out, "comment.md");
  await writeText(commentPath, renderPrComment(report), { artifact: "comment.md" });

  const exitCode =
    report.verdict.blocking && args.failOnRegression ? EXIT_CODE.QUALITY_GATE_FAILED : EXIT_CODE.OK;

  const summary: RunSummary = {
    runId,
    verdict: report.verdict.code,
    blocking: report.verdict.blocking,
    exitCode,
    regressions: report.summary.byClassification.REGRESSION,
    regressionGroups: report.summary.groups.REGRESSION,
    undetermined: report.summary.byClassification.UNDETERMINED,
    noise: report.summary.byClassification.NOISE,
    observationsCompared: report.coverage.observationsCompared,
    confidenceMode: report.metadata.confidenceMode,
    healingsProposed: base.trace.healings.length + head.trace.healings.length,
    report: reportPaths[0] ?? resolve(out, "report.json"),
    reportHtml: reportPaths[1] ?? resolve(out, "report.html"),
    comment: commentPath,
  };
  await writeText(resolve(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, {
    artifact: "summary.json",
  });

  process.stdout.write(renderConsoleSummary(report, [...reportPaths, commentPath]));
  return exitCode;
}
