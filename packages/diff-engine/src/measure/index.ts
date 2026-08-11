import type { Classification, Delta } from "../types/delta.js";

/**
 * Medição de precisão e recall contra rotulagem humana.
 *
 * Este módulo existe por duas exigências do projeto:
 *
 *  - §7 do CLAUDE.md: "toda mudança no diff-engine reporta delta de precisão e
 *    recall". Sem instrumento, isso vira promessa.
 *  - §21.2: o critério de saída da Fase 0 é numérico. Um critério numérico sem
 *    a ferramenta que produz o número não é critério, é intenção.
 *
 * O vocabulário de rótulo humano é o mesmo do motor (RN-ORC-009) de propósito:
 * o humano responde a mesma pergunta que o motor respondeu, e a divergência
 * entre as duas respostas é exatamente o erro que se quer medir. Rótulo `NOISE`
 * alimenta depois as regras de supressão (RN-ORC-010).
 */

export type HumanLabel = "REGRESSION" | "INTENDED_CHANGE" | "NOISE";

export interface LabelEntry {
  readonly label: HumanLabel;
  /** Por que o humano decidiu assim. Vira evidência de supressão depois. */
  readonly note?: string;
  /**
   * Identificador do defeito que causou este delta.
   *
   * Existe porque **um defeito produz muitos deltas**. Um link de menu que
   * passa a apontar para rota inexistente aparece no cabeçalho e no rodapé de
   * sete páginas: catorze deltas, um defeito. Contar deltas e anunciar
   * "catorze regressões detectadas" seria inflar o número por catorze.
   *
   * O critério de saída da Fase 0 fala em "≥ 5 regressões reais" — regressão,
   * não delta. Sem este campo não há como responder à pergunta que o critério
   * faz, e a medição responderia a outra, mais fácil.
   */
  readonly defect?: string;
}

export type LabelSet = Readonly<Record<string, LabelEntry>>;

export interface ConfusionMatrix {
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly trueNegatives: number;
  /** TP / (TP + FP). `null` quando o motor não apontou nada. */
  readonly precision: number | null;
  /** TP / (TP + FN). `null` quando não há regressão real rotulada. */
  readonly recall: number | null;
  /** FP / (TP + FP) — a taxa que o critério de saída da Fase 0 limita. */
  readonly falsePositiveRate: number | null;
}

/**
 * Contagem por DEFEITO, não por delta. Um defeito é "detectado" quando pelo
 * menos um dos deltas que ele causou foi apontado pelo motor — que é o que
 * importa na prática: basta um delta chegar ao relatório para o time descobrir
 * o problema.
 */
export interface DefectCoverage {
  /** Defeitos reais presentes na amostra, segundo a rotulagem humana. */
  readonly total: number;
  /** Defeitos com ao menos um delta apontado pelo motor. */
  readonly detected: number;
  readonly detectedIds: readonly string[];
  /** Defeitos que existiam e passaram inteiros — nenhum delta apontado. */
  readonly missedIds: readonly string[];
  /**
   * Deltas rotulados como regressão sem defeito declarado. Não entram na
   * contagem de defeitos: cobertura sem rastreabilidade não é cobertura.
   */
  readonly unattributed: number;
}

export interface Measurement {
  readonly totalDeltas: number;
  readonly labeled: number;
  readonly unlabeled: number;
  readonly unlabeledDeltaIds: readonly string[];
  /**
   * Recorte estrito: só conta como "apontado" o delta que o motor classificou
   * como REGRESSION, isto é, o que de fato bloqueia um PR. É o recorte que
   * importa para a confiança no gate.
   */
  readonly blocking: ConfusionMatrix;
  /**
   * Recorte amplo: conta como "apontado" qualquer delta que o motor tenha
   * exibido, inclusive UNDETERMINED. Mede o que chega à triagem humana, não o
   * que bloqueia.
   */
  readonly surfaced: ConfusionMatrix;
  /** Defeitos distintos alcançados pelo recorte bloqueante. */
  readonly blockingDefects: DefectCoverage;
  /** Defeitos distintos alcançados pelo recorte de triagem. */
  readonly surfacedDefects: DefectCoverage;
  readonly exitCriteria: ExitCriteriaCheck;
}

/** §21.2 — critério de saída da Fase 0. */
export interface ExitCriteriaCheck {
  readonly requiredDefects: number;
  readonly maxFalsePositiveRate: number;
  /** Defeitos distintos bloqueados — a unidade que o critério nomeia. */
  readonly defectsDetected: number;
  /** Deltas verdadeiros positivos. Informativo; não é o critério. */
  readonly truePositives: number;
  readonly falsePositiveRate: number | null;
  readonly met: boolean;
  readonly reason: string;
}

export const PHASE_0_REQUIRED_DEFECTS = 5;
export const PHASE_0_MAX_FALSE_POSITIVE_RATE = 0.1;

export function measure(deltas: readonly Delta[], labels: LabelSet): Measurement {
  const unlabeledDeltaIds = deltas
    .filter((delta) => labels[delta.deltaId] === undefined)
    .map((delta) => delta.deltaId);

  const isBlocking = (classification: Classification): boolean => classification === "REGRESSION";
  const blocking = confusion(deltas, labels, isBlocking);
  const surfaced = confusion(deltas, labels, () => true);
  const blockingDefects = defectCoverage(deltas, labels, isBlocking);

  return {
    totalDeltas: deltas.length,
    labeled: deltas.length - unlabeledDeltaIds.length,
    unlabeled: unlabeledDeltaIds.length,
    unlabeledDeltaIds,
    blocking,
    surfaced,
    blockingDefects,
    surfacedDefects: defectCoverage(deltas, labels, () => true),
    exitCriteria: checkExitCriteria(blocking, blockingDefects, unlabeledDeltaIds.length),
  };
}

function defectCoverage(
  deltas: readonly Delta[],
  labels: LabelSet,
  isFlagged: (classification: Classification) => boolean,
): DefectCoverage {
  const all = new Set<string>();
  const detected = new Set<string>();
  let unattributed = 0;

  for (const delta of deltas) {
    const entry = labels[delta.deltaId];
    if (entry === undefined || entry.label !== "REGRESSION") continue;
    if (entry.defect === undefined || entry.defect.length === 0) {
      unattributed += 1;
      continue;
    }
    all.add(entry.defect);
    if (isFlagged(delta.classification)) detected.add(entry.defect);
  }

  const detectedIds = [...detected].sort();
  return {
    total: all.size,
    detected: detected.size,
    detectedIds,
    missedIds: [...all].filter((defect) => !detected.has(defect)).sort(),
    unattributed,
  };
}

function confusion(
  deltas: readonly Delta[],
  labels: LabelSet,
  isFlagged: (classification: Classification) => boolean,
): ConfusionMatrix {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let trueNegatives = 0;

  for (const delta of deltas) {
    const entry = labels[delta.deltaId];
    // Delta sem rótulo não entra na conta. Chutar rótulo para inflar amostra é
    // a forma mais fácil de produzir um número bonito e falso.
    if (entry === undefined) continue;

    const flagged = isFlagged(delta.classification);
    const isRealRegression = entry.label === "REGRESSION";

    if (flagged && isRealRegression) truePositives += 1;
    else if (flagged && !isRealRegression) falsePositives += 1;
    else if (!flagged && isRealRegression) falseNegatives += 1;
    else trueNegatives += 1;
  }

  const flaggedTotal = truePositives + falsePositives;
  const realTotal = truePositives + falseNegatives;

  return {
    truePositives,
    falsePositives,
    falseNegatives,
    trueNegatives,
    precision: flaggedTotal === 0 ? null : truePositives / flaggedTotal,
    recall: realTotal === 0 ? null : truePositives / realTotal,
    falsePositiveRate: flaggedTotal === 0 ? null : falsePositives / flaggedTotal,
  };
}

function checkExitCriteria(
  blocking: ConfusionMatrix,
  defects: DefectCoverage,
  unlabeled: number,
): ExitCriteriaCheck {
  const base = {
    requiredDefects: PHASE_0_REQUIRED_DEFECTS,
    maxFalsePositiveRate: PHASE_0_MAX_FALSE_POSITIVE_RATE,
    defectsDetected: defects.detected,
    truePositives: blocking.truePositives,
    falsePositiveRate: blocking.falsePositiveRate,
  };

  // Amostra incompleta não atesta nada. Declarar critério atingido com deltas
  // por rotular seria exatamente o autoengano que PA-10 existe para impedir.
  if (unlabeled > 0) {
    return {
      ...base,
      met: false,
      reason: `${unlabeled} delta(s) sem rótulo humano — a amostra está incompleta`,
    };
  }
  // Regressão rotulada sem defeito declarado não é contável: não dá para saber
  // se dois deltas são o mesmo problema visto duas vezes.
  if (defects.unattributed > 0) {
    return {
      ...base,
      met: false,
      reason: `${defects.unattributed} delta(s) rotulado(s) como regressão sem defeito declarado — impossível contar defeitos distintos`,
    };
  }
  if (defects.detected < PHASE_0_REQUIRED_DEFECTS) {
    return {
      ...base,
      met: false,
      reason:
        `${defects.detected} defeito(s) distinto(s) bloqueado(s) de ${defects.total} presente(s); ` +
        `o critério exige ${PHASE_0_REQUIRED_DEFECTS}` +
        (defects.missedIds.length > 0 ? ` — passaram: ${defects.missedIds.join(", ")}` : ""),
    };
  }
  if (
    blocking.falsePositiveRate !== null &&
    blocking.falsePositiveRate >= PHASE_0_MAX_FALSE_POSITIVE_RATE
  ) {
    return {
      ...base,
      met: false,
      reason: `taxa de falso positivo de ${(blocking.falsePositiveRate * 100).toFixed(1)}%; o critério exige menos de ${PHASE_0_MAX_FALSE_POSITIVE_RATE * 100}%`,
    };
  }

  return {
    ...base,
    met: true,
    reason:
      `${defects.detected} defeitos distintos bloqueados (de ${defects.total}) ` +
      `com ${((blocking.falsePositiveRate ?? 0) * 100).toFixed(1)}% de falso positivo nos deltas`,
  };
}

/**
 * Esqueleto de rotulagem: um arquivo com todos os deltas e o veredito do motor,
 * para o humano preencher. O rótulo nasce vazio de propósito — pré-preencher
 * com o palpite do motor induziria concordância e contaminaria a medição.
 */
export function scaffoldLabels(deltas: readonly Delta[]): Record<string, unknown> {
  const entries: Record<string, unknown> = {};
  for (const delta of deltas) {
    entries[delta.deltaId] = {
      label: "",
      defect: "",
      note: "",
      _motor: delta.classification,
      _tipo: delta.kind,
      _onde: `${delta.observationId} · ${delta.path}`,
      _antes: delta.before,
      _depois: delta.after,
    };
  }
  return {
    _instrucoes:
      "Preencha 'label' com REGRESSION, INTENDED_CHANGE ou NOISE. Em REGRESSION, preencha " +
      "também 'defect' com um identificador do problema — deltas que vêm do mesmo problema " +
      "usam o MESMO identificador, senão um defeito espalhado por sete páginas vira sete " +
      "regressões na contagem. Campos com _ são contexto e são ignorados.",
    labels: entries,
  };
}
