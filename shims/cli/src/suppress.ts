import { access } from "node:fs/promises";
import { resolve } from "node:path";

import {
  emptySuppressionSet,
  parseSuppressionSet,
  proposeSuppressions,
  simulateSuppression,
  validateSuppressionSet,
  type DiffReport,
  type ProposalOutcome,
  type SuppressionSet,
  type SuppressionSimulation,
} from "@aletheia/diff-engine";
import { EXIT_CODE, PlatformError, systemClock } from "@aletheia/shared";

import type { SuppressProposeArgs, SuppressSimulateArgs } from "./args.js";
import { readJson, writeJson } from "./io.js";
import { parseLabels } from "./measure.js";

/**
 * `aletheia suppress` — o laço de RN-ORC-010 na linha de comando.
 *
 *   propose   rótulos NOISE de um relatório ⇒ regras PROPOSED no arquivo do projeto
 *   simulate  "se estas regras valessem, o que mudaria neste relatório, a que custo?"
 *
 * Nenhum dos dois altera veredito. Quem altera é `diff --suppressions`, e só
 * para regras `ACTIVE` — promoção que este comando NÃO faz: ela é edição humana
 * do arquivo, com `reviewedBy` preenchido. Automatizar a promoção seria
 * remover a única etapa em que alguém lê o que a regra deixa de ver.
 */

export async function suppressProposeCommand(args: SuppressProposeArgs): Promise<number> {
  const report = (await readJson(args.report)) as DiffReport;
  const labels = parseLabels(await readJson(args.labels), args.labels);
  const existing = await loadOrCreateSet(args.rules, args.project);

  const outcome = proposeSuppressions({
    report,
    labels,
    existing,
    labeledBy: args.labeledBy,
    nowUtc: systemClock.nowUtcIso(),
  });

  await writeJson(args.rules, outcome.set);
  process.stdout.write(renderProposal(outcome, args.rules, report));
  return EXIT_CODE.OK;
}

export async function suppressSimulateCommand(args: SuppressSimulateArgs): Promise<number> {
  const report = (await readJson(args.report)) as DiffReport;
  const set = await loadSet(args.rules);
  const labels =
    args.labels === null ? null : parseLabels(await readJson(args.labels), args.labels);

  const simulation = simulateSuppression(set, report, labels);
  process.stdout.write(renderSimulation(simulation, set, report, labels !== null));

  // Regra que suprimiria detecção verdadeira é o que o §6.4 proíbe. O código de
  // saída existe para a bancada e o CI poderem tratar isso como reprovação.
  return simulation.trueRegressionsLost.length > 0 ? EXIT_CODE.QUALITY_GATE_FAILED : EXIT_CODE.OK;
}

export async function loadSet(path: string): Promise<SuppressionSet> {
  const set = parseSuppressionSet(await readJson(path, "SUPPRESSION_SET_INVALID"), path);
  const issues = validateSuppressionSet(set);
  if (issues.length > 0) {
    throw new PlatformError("SUPPRESSION_SET_INVALID", {
      source: resolve(path),
      reason: issues.map((issue) => `${issue.ruleId ?? "-"}: ${issue.problem}`).join("; "),
    });
  }
  return set;
}

async function loadOrCreateSet(path: string, project: string | null): Promise<SuppressionSet> {
  if (await exists(path)) {
    const set = await loadSet(path);
    if (project !== null && project !== set.projectId) {
      throw new PlatformError("SUPPRESSION_SET_INVALID", {
        source: resolve(path),
        reason: `--project ${project} difere do projectId do arquivo (${set.projectId})`,
      });
    }
    return set;
  }
  if (project === null) {
    throw new PlatformError("SUPPRESSION_SET_INVALID", {
      source: resolve(path),
      reason: "arquivo não existe; informe --project <id> para criá-lo",
    });
  }
  return emptySuppressionSet(project);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(resolve(path));
    return true;
  } catch {
    return false;
  }
}

function renderProposal(outcome: ProposalOutcome, rulesPath: string, report: DiffReport): string {
  const lines = [
    "",
    `  supressão aprendida — projeto ${outcome.set.projectId}, execução ${report.metadata.runId}`,
    `  arquivo      ${resolve(rulesPath)}`,
    `  regras       ${outcome.set.rules.length} no arquivo · ${outcome.created.length} nova(s) PROPOSED · ${outcome.reinforced.length} reforçada(s)`,
  ];
  if (outcome.outOfScope > 0) {
    lines.push(
      `  fora do DOM  ${outcome.outOfScope} delta(s) NOISE de rede/visual ignorados — ruído lá é normalização ou máscara, não regra por projeto`,
    );
  }
  for (const id of outcome.created) {
    const rule = outcome.set.rules.find((entry) => entry.id === id);
    if (rule === undefined) continue;
    const runs = new Set(rule.evidence.map((entry) => entry.runId)).size;
    lines.push(
      "",
      `  + ${id}  [PROPOSED]`,
      `    ${rule.signature.kind} @ ${rule.signature.pathSkeleton}`,
      `    evidência: ${rule.evidence.length} delta(s) em ${runs} execução(ões) distinta(s)`,
    );
  }
  for (const id of outcome.reinforced) {
    const rule = outcome.set.rules.find((entry) => entry.id === id);
    if (rule === undefined) continue;
    const runs = new Set(rule.evidence.map((entry) => entry.runId)).size;
    lines.push(
      "",
      `  ↑ ${id}  [${rule.status}]  evidência agora: ${rule.evidence.length} delta(s) em ${runs} execução(ões)`,
    );
  }
  if (outcome.contradicted.length > 0) {
    lines.push(
      "",
      `  ! ${outcome.contradicted.length} regra(s) REJECTED/RETIRED reapareceram rotuladas NOISE: ${outcome.contradicted.join(", ")}`,
      "    Nada foi alterado. Se a decisão mudou, quem a tomou muda o status — não o aprendizado.",
    );
  }
  for (const conflict of outcome.conflicts) {
    lines.push(
      "",
      `  ✗ NÃO proposta: ${conflict.signature.kind} @ ${conflict.signature.pathSkeleton}`,
      `    ${conflict.noiseDeltaIds.length} delta(s) NOISE pediam a regra, mas ela também casaria ${conflict.regressionDeltaIds.length} rotulado(s) REGRESSION:`,
      ...conflict.regressionDeltaIds.slice(0, 5).map((deltaId) => `      ${deltaId}`),
      conflict.existingRuleId === null
        ? "    Regra que apaga regressão real não nasce (CLAUDE.md §6.4)."
        : `    E JÁ EXISTE como ${conflict.existingRuleId} — reveja o status dela antes de qualquer outra coisa.`,
    );
  }
  lines.push(
    "",
    "  Nenhuma regra proposta suprime nada. Para valer, um humano identificado muda",
    "  status para ACTIVE e preenche reviewedBy — e o motor só aceita ACTIVE com",
    "  evidência de 3 execuções distintas. Rode `suppress simulate` antes.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function renderSimulation(
  simulation: SuppressionSimulation,
  set: SuppressionSet,
  report: DiffReport,
  labeled: boolean,
): string {
  const blockingNow = report.deltas.filter((delta) => delta.classification === "REGRESSION").length;
  const lines = [
    "",
    `  simulação de supressão — ${set.projectId} · ${set.rules.length} regra(s) · execução ${report.metadata.runId}`,
    "  Nada aqui altera o relatório. É a resposta a: se as regras PROPOSED/ACTIVE valessem, o que mudaria?",
    "",
    "  regra              status    casa  regr  indet  |  humano: regr  intenc  ruído  s/rót",
  ];
  for (const rule of simulation.rules) {
    const c = rule.matchedByClassification;
    const l = rule.matchedByLabel;
    lines.push(
      `  ${rule.ruleId.padEnd(18)} ${rule.status.padEnd(9)} ${String(rule.matched.length).padStart(4)}  ${String(c.REGRESSION).padStart(4)}  ${String(c.UNDETERMINED).padStart(5)}  |          ${String(l.regression).padStart(4)}  ${String(l.intendedChange).padStart(6)}  ${String(l.noise).padStart(5)}  ${String(l.unlabeled).padStart(5)}`,
    );
  }
  lines.push(
    "",
    `  bloqueantes hoje ${blockingNow}  →  se PROPOSED/ACTIVE valessem: ${simulation.regressionsRemaining}  (${simulation.wouldSuppress.length} delta(s) suprimidos)`,
  );
  if (!labeled) {
    lines.push("  SEM RÓTULOS: o custo é desconhecido, não zero. Passe --labels para medi-lo.");
  } else if (simulation.trueRegressionsLost.length > 0) {
    lines.push(
      `  DETECÇÃO PERDIDA: ${simulation.trueRegressionsLost.length} delta(s) bloqueado(s) pelo motor E rotulado(s) REGRESSION seriam suprimidos:`,
      ...simulation.trueRegressionsLost.slice(0, 10).map((deltaId) => `    ${deltaId}`),
      "  Regra que faz isso não pode ser ativada (CLAUDE.md §6.4).",
    );
  } else {
    lines.push(
      "  detecção perdida: 0 — nenhum delta bloqueado e rotulado REGRESSION seria suprimido.",
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
