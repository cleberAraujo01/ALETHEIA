import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  measure,
  scaffoldLabels,
  type DiffReport,
  type LabelEntry,
  type LabelSet,
  type Measurement,
} from "@aletheia/diff-engine";
import { EXIT_CODE, PlatformError } from "@aletheia/shared";

import type { MeasureCommandArgs } from "./args.js";

/**
 * Fecha o laço da Fase 0: relatório + rotulagem humana ⇒ precisão e recall.
 *
 * O comando não julga nada por conta própria. Ele confronta o que o motor
 * decidiu com o que uma pessoa decidiu e mostra a distância entre os dois.
 */
export async function measureCommand(args: MeasureCommandArgs): Promise<number> {
  const report = (await readJson(resolve(args.report))) as DiffReport;

  if (args.emitLabels !== null) {
    const target = resolve(args.emitLabels);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(scaffoldLabels(report.deltas), null, 2)}\n`, "utf8");
    process.stdout.write(
      `\n  esqueleto de rotulagem escrito em ${target}\n` +
        `  ${report.deltas.length} delta(s) para rotular como REGRESSION, INTENDED_CHANGE ou NOISE\n\n`,
    );
    return EXIT_CODE.OK;
  }

  if (args.labels === null) {
    throw new PlatformError("CAPTURE_INVALID", {
      reason: "informe --labels <arquivo> ou --emit-labels <arquivo>",
    });
  }

  const result = measure(report.deltas, parseLabels(await readJson(resolve(args.labels)), args.labels));
  process.stdout.write(render(result, report));

  // O código de saída reflete o critério de saída da fase, não o veredito da
  // aplicação: aqui quem está sendo avaliado é o motor.
  return result.exitCriteria.met ? EXIT_CODE.OK : EXIT_CODE.QUALITY_GATE_FAILED;
}

function parseLabels(raw: unknown, source: string): LabelSet {
  if (typeof raw !== "object" || raw === null) {
    throw new PlatformError("CAPTURE_INVALID", { source, reason: "arquivo de rótulos inválido" });
  }
  const root = raw as Record<string, unknown>;
  const container = (root["labels"] ?? root) as Record<string, unknown>;
  const labels: Record<string, LabelEntry> = {};

  for (const [deltaId, value] of Object.entries(container)) {
    if (deltaId.startsWith("_")) continue;
    if (typeof value !== "object" || value === null) continue;
    const entry = value as Record<string, unknown>;
    const label = entry["label"];
    if (label === "REGRESSION" || label === "INTENDED_CHANGE" || label === "NOISE") {
      const note = entry["note"];
      labels[deltaId] =
        typeof note === "string" && note.length > 0 ? { label, note } : { label };
    }
  }

  return labels;
}

function render(result: Measurement, report: DiffReport): string {
  const pct = (value: number | null): string =>
    value === null ? "n/d" : `${(value * 100).toFixed(1)}%`;

  const lines = [
    "",
    `  base ${report.base.label} (${report.base.commit ?? "sem commit"})  ×  head ${report.head.label} (${report.head.commit ?? "sem commit"})`,
    `  ${result.labeled} de ${result.totalDeltas} delta(s) rotulado(s)`,
    "",
    "  recorte BLOQUEANTE — deltas classificados como REGRESSION",
    `    verdadeiro positivo ${result.blocking.truePositives}   falso positivo ${result.blocking.falsePositives}   falso negativo ${result.blocking.falseNegatives}`,
    `    precisão ${pct(result.blocking.precision)}   recall ${pct(result.blocking.recall)}   falso positivo ${pct(result.blocking.falsePositiveRate)}`,
    "",
    "  recorte TRIAGEM — todo delta exibido, inclusive UNDETERMINED",
    `    verdadeiro positivo ${result.surfaced.truePositives}   falso positivo ${result.surfaced.falsePositives}   falso negativo ${result.surfaced.falseNegatives}`,
    `    precisão ${pct(result.surfaced.precision)}   recall ${pct(result.surfaced.recall)}`,
    "",
    `  CRITÉRIO DE SAÍDA DA FASE 0: ${result.exitCriteria.met ? "ATINGIDO" : "NÃO ATINGIDO"}`,
    `    ${result.exitCriteria.reason}`,
    "",
  ];

  if (result.unlabeled > 0) {
    lines.push(
      `  ${result.unlabeled} delta(s) sem rótulo:`,
      ...result.unlabeledDeltaIds.slice(0, 10).map((id) => `    ${id}`),
      "",
    );
  }

  return `${lines.join("\n")}\n`;
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
