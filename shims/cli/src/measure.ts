import { resolve } from "node:path";

import {
  assessGrouping,
  measure,
  scaffoldLabels,
  type DiffReport,
  type GroupingAssessment,
  type LabelEntry,
  type LabelSet,
  type Measurement,
} from "@aletheia/diff-engine";
import { EXIT_CODE, PlatformError } from "@aletheia/shared";

import type { MeasureCommandArgs } from "./args.js";
import { readJson, writeJson } from "./io.js";

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
    await writeJson(target, scaffoldLabels(report.deltas));
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

  const labels = parseLabels(await readJson(resolve(args.labels)), args.labels);
  const result = measure(report.deltas, labels);
  process.stdout.write(render(result, report));
  process.stdout.write(renderGrouping(assessGrouping(report.groups, labels)));

  // O código de saída reflete o critério de saída da fase, não o veredito da
  // aplicação: aqui quem está sendo avaliado é o motor.
  return result.exitCriteria.met ? EXIT_CODE.OK : EXIT_CODE.QUALITY_GATE_FAILED;
}

export function parseLabels(raw: unknown, source: string): LabelSet {
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
      const defect = entry["defect"];
      labels[deltaId] = {
        label,
        ...(typeof note === "string" && note.length > 0 ? { note } : {}),
        ...(typeof defect === "string" && defect.length > 0 ? { defect } : {}),
      };
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
    "  DEFEITOS DISTINTOS — a unidade do critério de saída",
    `    bloqueados ${result.blockingDefects.detected} de ${result.blockingDefects.total}` +
      (result.blockingDefects.missedIds.length > 0
        ? `   passaram: ${result.blockingDefects.missedIds.join(", ")}`
        : ""),
    `    exibidos   ${result.surfacedDefects.detected} de ${result.surfacedDefects.total}` +
      (result.surfacedDefects.missedIds.length > 0
        ? `   invisíveis: ${result.surfacedDefects.missedIds.join(", ")}`
        : ""),
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

/**
 * Grupo é afirmação ("mesma causa provável"); o defeito rotulado é a causa de
 * verdade. Mostrar a distância entre os dois é o que impede o número de grupos
 * de virar um número bonito que ninguém confere.
 */
function renderGrouping(assessment: GroupingAssessment): string {
  const perDefect = Object.entries(assessment.regressionGroupsPerDefect).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const spread = perDefect.filter(([, count]) => count > 1);
  const lines = [
    "  AGRUPAMENTO — grupo é causa provável, defeito é causa rotulada",
    `    ${assessment.groups} grupo(s), ${assessment.regressionGroups} de regressão, ${assessment.labeledGroups} com algum delta rotulado`,
    `    grupos que misturam defeitos distintos: ${assessment.mixedDefects.length}` +
      (assessment.mixedDefects.length > 0 ? `  (${assessment.mixedDefects.join(", ")})` : ""),
    `    grupos que misturam regressão com ruído/intencional: ${assessment.mixedWithNonRegression.length}` +
      (assessment.mixedWithNonRegression.length > 0
        ? `  (${assessment.mixedWithNonRegression.join(", ")}) — rotular o grupo como ruído apagaria regressão`
        : ""),
  ];
  if (perDefect.length > 0) {
    lines.push(
      `    defeitos em mais de um grupo de regressão: ${spread.length} de ${perDefect.length}` +
        (spread.length > 0 ? `  (${spread.map(([id, n]) => `${id}: ${n}`).join(", ")})` : ""),
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
