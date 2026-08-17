import { stableHash } from "@aletheia/shared";

import { signatureKey, signatureOf } from "../signature/index.js";
import type { Classification, Delta, Severity } from "../types/delta.js";

/**
 * Agrupamento de deltas — o mesmo defeito, visto muitas vezes.
 *
 * Um defeito produz muitos deltas: `alt` removido de toda miniatura de toda
 * listagem virou 105 linhas bloqueantes no oscar (§10.11 da medição) sem que a
 * contagem por defeito passasse de 6 de 7. Quem abre o relatório vê o volume, e
 * volume não é informação. Este módulo agrupa por ASSINATURA — mesma camada,
 * mesmo tipo, mesmo esqueleto de caminho, em qualquer página — que é a melhor
 * aproximação determinística de "mesma causa" que o motor tem sem conhecer o
 * diff de código.
 *
 * O QUE UM GRUPO AFIRMA, E O QUE NÃO. Afirma que os deltas mudaram o mesmo tipo
 * de coisa no mesmo lugar estrutural. NÃO afirma que vêm do mesmo commit: essa
 * é a unidade `defect` da rotulagem humana, e a distância entre as duas — grupo
 * que mistura defeitos, defeito espalhado por muitos grupos — é medida em
 * `measure/assessGrouping`, contra os rótulos, e não escondida.
 *
 * O grupo NÃO muda veredito, severidade nem classificação de delta nenhum. Ele é
 * apresentação e chave de triagem: um humano rotula um grupo, e a supressão
 * aprendida (que usa a mesma assinatura) sabe exatamente o que cobrir.
 */
export interface DeltaGroup {
  /** Determinístico: hash da assinatura. Mesmo par ⇒ mesmos grupos. */
  readonly groupId: string;
  readonly layer: Delta["layer"];
  readonly kind: Delta["kind"];
  readonly pathSkeleton: string;
  /** Na ordem do relatório (mais grave primeiro). */
  readonly deltaIds: readonly string[];
  /** Distintas, ordenadas. */
  readonly observationIds: readonly string[];
  /** A pior entre os deltas do grupo. */
  readonly severity: Severity;
  readonly score: number;
  /** REGRESSION se qualquer delta bloqueia; senão a mais alta presente. */
  readonly classification: Classification;
  readonly byClassification: Readonly<Record<Classification, number>>;
}

const CLASSIFICATION_PRIORITY: readonly Classification[] = [
  "REGRESSION",
  "UNDETERMINED",
  "INTENDED_CHANGE",
  "NOISE",
];
const SEVERITY_PRIORITY: readonly Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

/**
 * A chave do grupo é a assinatura — com UMA exceção declarada: a camada visual
 * não agrupa entre observações. `screenshot @ 0,0 144×32` na home e no contato
 * são a mesma coordenada, não o mesmo elemento; medido contra os rótulos, era o
 * único grupo que misturava defeitos distintos. Pixel não tem identidade
 * estrutural, e fingir que tem seria juntar causas diferentes sob um título.
 */
export function groupIdOf(delta: Pick<Delta, "layer" | "kind" | "path" | "observationId">): string {
  const key = signatureKey(signatureOf(delta));
  return stableHash(delta.layer === "VISUAL" ? `${key} @ ${delta.observationId}` : key);
}

/** Espera os deltas já na ordem final do relatório. */
export function groupDeltas(deltas: readonly Delta[]): DeltaGroup[] {
  const groups = new Map<string, Delta[]>();
  for (const delta of deltas) {
    const id = groupIdOf(delta);
    const members = groups.get(id);
    if (members === undefined) groups.set(id, [delta]);
    else members.push(delta);
  }

  const out: DeltaGroup[] = [];
  for (const [groupId, members] of groups) {
    const first = members[0];
    if (first === undefined) continue;
    const byClassification: Record<Classification, number> = {
      REGRESSION: 0,
      INTENDED_CHANGE: 0,
      NOISE: 0,
      UNDETERMINED: 0,
    };
    for (const member of members) byClassification[member.classification] += 1;

    out.push({
      groupId,
      layer: first.layer,
      kind: first.kind,
      pathSkeleton: signatureOf(first).pathSkeleton,
      deltaIds: members.map((member) => member.deltaId),
      observationIds: [...new Set(members.map((member) => member.observationId))].sort(),
      severity: worst(members.map((member) => member.severity)),
      score: Math.max(...members.map((member) => member.score)),
      classification:
        CLASSIFICATION_PRIORITY.find((entry) => byClassification[entry] > 0) ?? "UNDETERMINED",
      byClassification,
    });
  }

  // Mais grave primeiro; desempate por tamanho (o que mais aparece sobe) e por
  // chave, para duas execuções produzirem a mesma ordem.
  return out.sort(
    (a, b) =>
      b.score - a.score ||
      b.deltaIds.length - a.deltaIds.length ||
      a.kind.localeCompare(b.kind) ||
      a.pathSkeleton.localeCompare(b.pathSkeleton),
  );
}

function worst(severities: readonly Severity[]): Severity {
  return SEVERITY_PRIORITY.find((entry) => severities.includes(entry)) ?? "LOW";
}
