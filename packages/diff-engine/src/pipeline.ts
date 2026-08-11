import { PlatformError, stableHash, type RunMetadata } from "@aletheia/shared";

import { classify } from "./classify/index.js";
import { diffDom } from "./diff/dom.js";
import { diffNetwork } from "./diff/network.js";
import { diffVisual } from "./diff/visual.js";
import {
  DEFAULT_DELTA_BUDGET_PER_OBSERVATION,
  DeltaBudget,
  type RawDelta,
} from "./diff/types.js";
import { normalizeDom } from "./normalize/dom.js";
import { createLedger } from "./normalize/ledger.js";
import { normalizeExchange } from "./normalize/network.js";
import { originOf, type UrlNormalizationOptions } from "./normalize/url.js";
import { DEFAULT_CALIBRATION, type Calibration } from "./score/calibration.js";
import { scoreOf, severityOf } from "./score/index.js";
import { SUPPRESSION_CATALOG } from "./suppress/catalog.js";
import {
  applySuppression,
  validateSuppressionRules,
  type SuppressionRule,
} from "./suppress/rule.js";
import type { Capture, Observation } from "./types/capture.js";
import type { Classification, Delta, DeltaLayer, Severity } from "./types/delta.js";
import type { RasterSet } from "./types/raster.js";
import { DEFAULT_VISUAL_OPTIONS, type VisualComparisonOptions } from "./visual/compare.js";
import {
  REPORT_VERSION,
  type CaptureSummary,
  type CoverageReport,
  type DiffReport,
  type LayerGap,
  type Verdict,
} from "./types/report.js";

export interface DiffOptions {
  readonly metadata: RunMetadata;
  readonly calibration?: Calibration;
  readonly suppressionRules?: readonly SuppressionRule[];
  readonly deltaBudgetPerObservation?: number;
  /**
   * Screenshots já decodificados, indexados por `observationId`. Quem carrega
   * e decodifica é o shim — o motor não toca em disco (ver `types/raster.ts`).
   * Ausentes ⇒ a camada visual vira lacuna declarada, não silêncio.
   */
  readonly rasters?: {
    readonly base: RasterSet;
    readonly head: RasterSet;
  };
  readonly visualOptions?: VisualComparisonOptions;
}

/**
 * Pipeline completo do Diff Engine (§12.4):
 *
 *   1 NORMALIZAÇÃO → 2 ALINHAMENTO → 3 DIFERENCIAÇÃO
 *   → 4 SUPRESSÃO → 5 PONTUAÇÃO → 6 CLASSIFICAÇÃO
 *
 * Puro e determinístico: mesmas capturas ⇒ mesmo relatório, bit a bit, exceto
 * pelos metadados de execução. Nada aqui lê relógio, rede, disco ou modelo.
 */
export function runDiff(base: Capture, head: Capture, options: DiffOptions): DiffReport {
  const calibration = options.calibration ?? DEFAULT_CALIBRATION;
  const rules = options.suppressionRules ?? SUPPRESSION_CATALOG;

  // O motor se recusa a rodar com catálogo inválido. Deixar passar seria
  // permitir supressão sem evidência — o modo silencioso de perder detecção.
  const ruleIssues = validateSuppressionRules(rules);
  if (ruleIssues.length > 0) {
    throw new PlatformError("INTERNAL_INVARIANT_BROKEN", {
      reason: "catálogo de supressão inválido",
      issues: ruleIssues.map((issue) => `${issue.ruleId}: ${issue.problem}`).join("; "),
    });
  }

  const ledger = createLedger();
  const baseUrlOptions: UrlNormalizationOptions = { selfOrigin: originOf(base.target.baseUrl) };
  const headUrlOptions: UrlNormalizationOptions = { selfOrigin: originOf(head.target.baseUrl) };

  const baseById = indexObservations(base);
  const headById = indexObservations(head);
  const commonIds = [...baseById.keys()].filter((id) => headById.has(id)).sort();
  const onlyInBase = [...baseById.keys()].filter((id) => !headById.has(id)).sort();
  const onlyInHead = [...headById.keys()].filter((id) => !baseById.has(id)).sort();

  if (commonIds.length === 0) {
    throw new PlatformError("CAPTURES_NOT_COMPARABLE", {
      reason: "nenhuma observação com observationId em comum entre base e head",
      baseObservations: baseById.size,
      headObservations: headById.size,
    });
  }

  const raw: RawDelta[] = [];
  const truncated: string[] = [];
  const domGaps: string[] = [];
  const networkGaps: string[] = [];
  const visualGaps: string[] = [];
  const budgetLimit = options.deltaBudgetPerObservation ?? DEFAULT_DELTA_BUDGET_PER_OBSERVATION;

  for (const id of onlyInBase) {
    const observation = baseById.get(id);
    if (observation === undefined) continue;
    raw.push({
      layer: "DOM",
      kind: "OBSERVATION_REMOVED",
      observationId: id,
      path: observation.route,
      before: observation.url,
      after: null,
      facts: { route: observation.route },
    });
  }

  for (const id of onlyInHead) {
    const observation = headById.get(id);
    if (observation === undefined) continue;
    raw.push({
      layer: "DOM",
      kind: "OBSERVATION_ADDED",
      observationId: id,
      path: observation.route,
      before: null,
      after: observation.url,
      facts: { route: observation.route },
    });
  }

  for (const id of commonIds) {
    const baseObservation = baseById.get(id);
    const headObservation = headById.get(id);
    if (baseObservation === undefined || headObservation === undefined) continue;

    const budget = new DeltaBudget(budgetLimit);

    if (baseObservation.dom !== null && headObservation.dom !== null) {
      raw.push(
        ...diffDom(
          id,
          normalizeDom(baseObservation.dom, baseUrlOptions, ledger),
          normalizeDom(headObservation.dom, headUrlOptions, ledger),
          budget,
        ),
      );
    } else {
      domGaps.push(id);
    }

    if (baseObservation.network !== null && headObservation.network !== null) {
      raw.push(
        ...diffNetwork(
          id,
          baseObservation.network.map((exchange) =>
            normalizeExchange(exchange, baseUrlOptions, ledger),
          ),
          headObservation.network.map((exchange) =>
            normalizeExchange(exchange, headUrlOptions, ledger),
          ),
          budget,
        ),
      );
    } else {
      networkGaps.push(id);
    }

    const baseRaster = options.rasters?.base.get(id);
    const headRaster = options.rasters?.head.get(id);
    if (baseRaster !== undefined && headRaster !== undefined) {
      // Máscaras vêm da base: são declaração de quem capturou sobre o que é
      // dinâmico naquela tela, e a base é a referência da comparação.
      raw.push(
        ...diffVisual(
          id,
          baseRaster,
          headRaster,
          baseObservation.screenshot?.masks ?? [],
          options.visualOptions ?? DEFAULT_VISUAL_OPTIONS,
          budget,
        ),
      );
    } else {
      visualGaps.push(id);
    }

    if (budget.truncated) truncated.push(id);
  }

  const deltas = finalize(raw, rules, calibration);

  return {
    reportVersion: REPORT_VERSION,
    metadata: options.metadata,
    oracle: "O5",
    oracleDescription:
      "Teste diferencial contra a versão anterior da própria aplicação (O5). " +
      "Não detecta defeito que já existia na base.",
    base: summarizeCapture(base),
    head: summarizeCapture(head),
    verdict: verdictOf(deltas),
    summary: summarize(deltas),
    normalization: { total: ledger.total(), byRule: ledger.counts() },
    suppression: summarizeSuppression(deltas, rules.length),
    coverage: coverageOf({
      compared: commonIds.length,
      onlyInBase,
      onlyInHead,
      truncated,
      domGaps,
      networkGaps,
      visualGaps,
    }),
    deltas,
  };
}

function finalize(
  raw: readonly RawDelta[],
  rules: readonly SuppressionRule[],
  calibration: Calibration,
): Delta[] {
  const usedIds = new Map<string, number>();

  const deltas = raw.map((delta): Delta => {
    const severity = severityOf(delta);
    const score = scoreOf(severity, calibration);
    const { suppressedBy } = applySuppression(delta, rules);

    const baseId = stableHash({
      layer: delta.layer,
      kind: delta.kind,
      observationId: delta.observationId,
      path: delta.path,
    });
    const collisions = usedIds.get(baseId) ?? 0;
    usedIds.set(baseId, collisions + 1);
    const deltaId = collisions === 0 ? baseId : `${baseId}:${collisions}`;

    return {
      deltaId,
      layer: delta.layer,
      kind: delta.kind,
      observationId: delta.observationId,
      path: delta.path,
      before: delta.before,
      after: delta.after,
      severity,
      score,
      classification: classify(score, suppressedBy, calibration),
      suppressedBy,
      facts: delta.facts,
    };
  });

  // Ordenação estável e determinística: o mais grave primeiro, desempate por
  // endereço. Duas execuções produzem o relatório na mesma ordem.
  return deltas.sort(
    (a, b) =>
      b.score - a.score ||
      a.observationId.localeCompare(b.observationId) ||
      a.path.localeCompare(b.path) ||
      a.kind.localeCompare(b.kind),
  );
}

function verdictOf(deltas: readonly Delta[]): Verdict {
  const regressions = deltas.filter((delta) => delta.classification === "REGRESSION").length;
  const undetermined = deltas.filter((delta) => delta.classification === "UNDETERMINED").length;

  if (regressions > 0) {
    return {
      code: "REGRESSION_DETECTED",
      blocking: true,
      rationale: `${regressions} delta(s) atingiram o limiar de regressão contra a build base.`,
    };
  }
  if (undetermined > 0) {
    return {
      code: "UNDETERMINED_ONLY",
      blocking: false,
      rationale:
        `${undetermined} delta(s) divergem da base mas não atingem o limiar de regressão. ` +
        "Não bloqueia (RN-ORC-009); requer triagem humana.",
    };
  }
  return {
    code: "NO_REGRESSION_DETECTED",
    blocking: false,
    rationale: "Nenhuma divergência sobreviveu à normalização e à supressão.",
  };
}

function summarize(deltas: readonly Delta[]): DiffReport["summary"] {
  const byClassification: Record<Classification, number> = {
    REGRESSION: 0,
    INTENDED_CHANGE: 0,
    NOISE: 0,
    UNDETERMINED: 0,
  };
  const bySeverity: Record<Severity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  const byLayer: Record<DeltaLayer, number> = { DOM: 0, NETWORK: 0, VISUAL: 0, CONSOLE: 0 };

  for (const delta of deltas) {
    byClassification[delta.classification] += 1;
    bySeverity[delta.severity] += 1;
    byLayer[delta.layer] += 1;
  }

  return { total: deltas.length, byClassification, bySeverity, byLayer };
}

function summarizeSuppression(
  deltas: readonly Delta[],
  catalogSize: number,
): DiffReport["suppression"] {
  const byRule: Record<string, number> = {};
  let deltasSuppressed = 0;
  for (const delta of deltas) {
    if (delta.suppressedBy === null) continue;
    deltasSuppressed += 1;
    byRule[delta.suppressedBy] = (byRule[delta.suppressedBy] ?? 0) + 1;
  }
  return { catalogSize, deltasSuppressed, byRule };
}

interface CoverageInput {
  readonly compared: number;
  readonly onlyInBase: readonly string[];
  readonly onlyInHead: readonly string[];
  readonly truncated: readonly string[];
  readonly domGaps: readonly string[];
  readonly networkGaps: readonly string[];
  readonly visualGaps: readonly string[];
}

function coverageOf(input: CoverageInput): CoverageReport {
  const layersNotValidated: LayerGap[] = [
    {
      layer: "CONSOLE",
      reason: "console é capturado como evidência, mas ainda não é comparado",
      observations: [],
    },
    {
      layer: "DATABASE",
      reason: "diff de banco entra na Fase 1 (E-02)",
      observations: [],
    },
    {
      layer: "TRACE",
      reason: "diff de spans depende de instrumentação OTel (Fase 2)",
      observations: [],
    },
  ];

  if (input.domGaps.length > 0) {
    layersNotValidated.push({
      layer: "DOM",
      reason: "DOM ausente em base ou head para estas observações",
      observations: input.domGaps,
    });
  }
  if (input.networkGaps.length > 0) {
    layersNotValidated.push({
      layer: "NETWORK",
      reason: "rede ausente em base ou head para estas observações",
      observations: input.networkGaps,
    });
  }
  if (input.visualGaps.length > 0) {
    layersNotValidated.push({
      layer: "VISUAL",
      reason: "screenshot ausente em base ou head para estas observações",
      observations: input.visualGaps,
    });
  }

  const notes = [
    "Oráculo O5 não detecta defeito já presente na build base — divergência zero não significa aplicação correta.",
    "Nenhum delta é classificado como INTENDED_CHANGE: não há fonte de intenção (requisito, diff de código ou contrato) nesta fase.",
    "Deltas visuais têm teto de severidade MEDIUM e portanto nunca bloqueiam: a camada visual ainda não foi calibrada contra corpus real.",
  ];
  if (input.truncated.length > 0) {
    notes.push(
      `Orçamento de deltas esgotado em ${input.truncated.length} observação(ões): o diff destas está INCOMPLETO.`,
    );
  }

  return {
    observationsCompared: input.compared,
    observationsOnlyInBase: input.onlyInBase,
    observationsOnlyInHead: input.onlyInHead,
    observationsTruncated: input.truncated,
    layersNotValidated,
    notes,
  };
}

function indexObservations(capture: Capture): Map<string, Observation> {
  return new Map(capture.observations.map((observation) => [observation.observationId, observation]));
}

function summarizeCapture(capture: Capture): CaptureSummary {
  return {
    captureId: capture.captureId,
    label: capture.target.label,
    baseUrl: capture.target.baseUrl,
    commit: capture.target.commit,
    capturedAtUtc: capture.target.capturedAtUtc,
    observationCount: capture.observations.length,
  };
}
