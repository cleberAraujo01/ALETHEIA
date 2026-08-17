import type { HumanLabel, LabelSet } from "../measure/index.js";
import type { Classification, Delta } from "../types/delta.js";
import type { DiffReport } from "../types/report.js";

import {
  type DeltaSignature,
  type LearnedSuppressionRule,
  matchesSignature,
  signatureKey,
  signatureOf,
  type SuppressionSet,
} from "./learned.js";
import type { EvidenceRef } from "./rule.js";

/**
 * Aprendizado de supressão — RN-ORC-010: "delta classificado como NOISE
 * alimenta automaticamente as regras de supressão, com revisão humana".
 *
 * O "automaticamente" é este arquivo. O "com revisão humana" é o status: tudo
 * que sai daqui nasce `PROPOSED`, e a promoção acontece fora, por uma pessoa
 * identificada. Nenhuma linha aqui decide o que É ruído — ela só agrupa o que
 * um humano já rotulou como ruído e o transforma em regra candidata com a
 * evidência anexada.
 *
 * O QUE ELE APRENDE, E O QUE NÃO. Só deltas de DOM. Rede e visual têm outros
 * instrumentos — normalização de URL e máscara de região — e todo ruído de rede
 * já encontrado nos pisos das aplicações desconhecidas era identidade de sessão
 * ou token, que se resolve na borda, não com regra por projeto. Aprender lá
 * seria esconder embaixo do tapete um achado de normalização.
 *
 * A BARREIRA CONTRA FALSO NEGATIVO É ESTRUTURAL. Uma assinatura candidata que
 * também casa com QUALQUER delta rotulado REGRESSION no mesmo relatório não vira
 * regra — vira conflito reportado. É o §6.4 do CLAUDE.md aplicado antes de a
 * regra existir: "nenhuma regra pode reduzir a detecção verdadeira".
 */

export interface ProposalInput {
  readonly report: DiffReport;
  readonly labels: LabelSet;
  readonly existing: SuppressionSet;
  /** Quem rotulou. Obrigatório: evidência anônima não é evidência. */
  readonly labeledBy: string;
  /** Injetado pelo chamador. O motor não lê relógio (ADR-012). */
  readonly nowUtc: string;
}

export interface SignatureConflict {
  readonly signature: DeltaSignature;
  /** Deltas rotulados NOISE que pediam a regra. */
  readonly noiseDeltaIds: readonly string[];
  /** Deltas rotulados REGRESSION que a mesma regra suprimiria. */
  readonly regressionDeltaIds: readonly string[];
  /** Regra existente com esta assinatura, se houver — e aí o conflito é grave. */
  readonly existingRuleId: string | null;
}

export interface ProposalOutcome {
  readonly set: SuppressionSet;
  /** Ids de regras novas, todas `PROPOSED`. */
  readonly created: readonly string[];
  /** Regras já existentes (`PROPOSED` ou `ACTIVE`) que ganharam evidência nova. */
  readonly reinforced: readonly string[];
  /** Regras `REJECTED`/`RETIRED` cuja assinatura reapareceu rotulada NOISE. Nada é alterado. */
  readonly contradicted: readonly string[];
  readonly conflicts: readonly SignatureConflict[];
  /** Deltas NOISE fora do escopo de aprendizado (camada que não é DOM). */
  readonly outOfScope: number;
}

export function proposeSuppressions(input: ProposalInput): ProposalOutcome {
  const { report, labels, existing } = input;
  const runId = report.metadata.runId;

  const labeled = (label: HumanLabel): Delta[] =>
    report.deltas.filter((delta) => labels[delta.deltaId]?.label === label);
  const regressions = labeled("REGRESSION");

  // 1. Agrupa os NOISE de DOM por assinatura. Ordem de inserção segue a ordem
  //    do relatório, que já é determinística — a saída também é.
  const groups = new Map<string, { signature: DeltaSignature; deltas: Delta[] }>();
  let outOfScope = 0;
  for (const delta of labeled("NOISE")) {
    if (delta.layer !== "DOM") {
      outOfScope += 1;
      continue;
    }
    const signature = signatureOf(delta);
    const key = signatureKey(signature);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { signature, deltas: [delta] });
    else group.deltas.push(delta);
  }

  const byKey = new Map(existing.rules.map((rule) => [signatureKey(rule.signature), rule]));
  const created: string[] = [];
  const reinforced: string[] = [];
  const contradicted: string[] = [];
  const conflicts: SignatureConflict[] = [];
  const rules: LearnedSuppressionRule[] = [...existing.rules];
  let next = nextOrdinal(existing);

  for (const [key, group] of groups) {
    const current = byKey.get(key) ?? null;

    // 2. Barreira: a assinatura casa com regressão real neste relatório?
    const hits = regressions.filter((delta) => matchesSignature(group.signature, delta));
    if (hits.length > 0) {
      conflicts.push({
        signature: group.signature,
        noiseDeltaIds: group.deltas.map((delta) => delta.deltaId),
        regressionDeltaIds: hits.map((delta) => delta.deltaId),
        existingRuleId: current?.id ?? null,
      });
      continue;
    }

    const evidence = group.deltas.map((delta): EvidenceRef => ({
      runId,
      deltaId: delta.deltaId,
      labeledBy: input.labeledBy,
      labeledAtUtc: input.nowUtc,
      note: labels[delta.deltaId]?.note ?? "",
    }));

    // 3. Regra existente: reforça, contradiz, ou nada.
    if (current !== null) {
      if (current.status === "REJECTED" || current.status === "RETIRED") {
        contradicted.push(current.id);
        continue;
      }
      // Dedup por deltaId, NÃO por (runId, deltaId). O deltaId é estável para o
      // mesmo par de capturas; o runId muda a cada `diff`. Deduplicar pelo par
      // deixaria alguém "acumular três execuções" re-diffando o mesmo PR três
      // vezes — e a barreira de evidência viraria decoração.
      const known = new Set(current.evidence.map((entry) => entry.deltaId));
      const fresh = evidence.filter((entry) => !known.has(entry.deltaId));
      if (fresh.length === 0) continue;
      const index = rules.findIndex((rule) => rule.id === current.id);
      rules[index] = { ...current, evidence: [...current.evidence, ...fresh] };
      reinforced.push(current.id);
      continue;
    }

    // 4. Regra nova, sempre PROPOSED.
    const id = `SUP-${existing.projectId}-${String(next).padStart(3, "0")}`;
    next += 1;
    rules.push({
      id,
      projectId: existing.projectId,
      status: "PROPOSED",
      description: describe(group.signature, group.deltas),
      signature: group.signature,
      evidence,
      proposedAtUtc: input.nowUtc,
      reviewedBy: null,
      reviewedAtUtc: null,
    });
    created.push(id);
  }

  return {
    set: { ...existing, rules },
    created,
    reinforced,
    contradicted,
    conflicts,
    outOfScope,
  };
}

function nextOrdinal(set: SuppressionSet): number {
  let max = 0;
  for (const rule of set.rules) {
    const tail = Number(rule.id.slice(rule.id.lastIndexOf("-") + 1));
    if (Number.isFinite(tail) && tail > max) max = tail;
  }
  return max + 1;
}

function describe(signature: DeltaSignature, deltas: readonly Delta[]): string {
  const blocking = deltas.filter((delta) => delta.classification === "REGRESSION").length;
  const observations = new Set(deltas.map((delta) => delta.observationId)).size;
  return (
    `${signature.kind} em ${signature.pathSkeleton} — rotulado NOISE em ${deltas.length} delta(s) ` +
    `de ${observations} observação(ões), ${blocking} bloqueante(s). ` +
    "Descreva aqui, antes de ativar, POR QUE isto é rotina nesta aplicação e o que o motor deixa de ver."
  );
}

// ---------------------------------------------------------------------------
// Simulação — o §6.4 aplicado a regras que ainda não valem
// ---------------------------------------------------------------------------

export interface RuleSimulation {
  readonly ruleId: string;
  readonly status: LearnedSuppressionRule["status"];
  readonly matched: readonly string[];
  readonly matchedByClassification: Readonly<Record<Classification, number>>;
  /**
   * Como o humano rotulou o que a regra casaria. `regression` > 0 é o custo
   * que o §6.4 proíbe. `unlabeled` é o que ninguém olhou — não é zero de custo,
   * é custo desconhecido.
   */
  readonly matchedByLabel: {
    readonly regression: number;
    readonly intendedChange: number;
    readonly noise: number;
    readonly unlabeled: number;
  };
}

export interface SuppressionSimulation {
  readonly rules: readonly RuleSimulation[];
  /** Deltas que ALGUMA regra `PROPOSED` ou `ACTIVE` casaria, sem repetição. */
  readonly wouldSuppress: readonly string[];
  /** Deltas classificados REGRESSION que sobrariam se todas as PROPOSED/ACTIVE valessem. */
  readonly regressionsRemaining: number;
  /** Deltas classificados REGRESSION que essas regras suprimiriam e um humano rotulou REGRESSION. */
  readonly trueRegressionsLost: readonly string[];
}

/**
 * Responde, sem alterar veredito nenhum: "se as regras deste conjunto valessem,
 * o que mudaria neste relatório, e a que custo?". É a medição de antes/depois
 * que o §6.4 exige — feita antes de a regra poder existir como `ACTIVE`, que é
 * o único momento em que a resposta ainda é barata.
 *
 * `REJECTED` e `RETIRED` também são simuladas e listadas, mas não entram no
 * agregado: o agregado é "o que aconteceria se as pendentes fossem aprovadas".
 */
export function simulateSuppression(
  set: SuppressionSet,
  report: DiffReport,
  labels: LabelSet | null,
): SuppressionSimulation {
  const would = new Set<string>();
  const lost: string[] = [];

  const rules = set.rules.map((rule): RuleSimulation => {
    const matched = report.deltas.filter((delta) => matchesSignature(rule.signature, delta));
    const byClassification: Record<Classification, number> = {
      REGRESSION: 0,
      INTENDED_CHANGE: 0,
      NOISE: 0,
      UNDETERMINED: 0,
    };
    const byLabel = { regression: 0, intendedChange: 0, noise: 0, unlabeled: 0 };
    for (const delta of matched) {
      byClassification[delta.classification] += 1;
      const label = labels?.[delta.deltaId]?.label;
      if (label === "REGRESSION") byLabel.regression += 1;
      else if (label === "INTENDED_CHANGE") byLabel.intendedChange += 1;
      else if (label === "NOISE") byLabel.noise += 1;
      else byLabel.unlabeled += 1;

      if (rule.status === "PROPOSED" || rule.status === "ACTIVE") {
        would.add(delta.deltaId);
        if (delta.classification === "REGRESSION" && label === "REGRESSION") {
          lost.push(delta.deltaId);
        }
      }
    }
    return {
      ruleId: rule.id,
      status: rule.status,
      matched: matched.map((delta) => delta.deltaId),
      matchedByClassification: byClassification,
      matchedByLabel: byLabel,
    };
  });

  const regressionsRemaining = report.deltas.filter(
    (delta) => delta.classification === "REGRESSION" && !would.has(delta.deltaId),
  ).length;

  return {
    rules,
    wouldSuppress: [...would],
    regressionsRemaining,
    trueRegressionsLost: [...new Set(lost)],
  };
}
