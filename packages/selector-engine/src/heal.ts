import type { Target } from "@aletheia/ir";

import type { Consensus } from "./consensus.js";
import type { Signal } from "./fingerprint.js";

/**
 * Cura de seletor — RN-EXE-011 / PA-08: **registrada com diff, evidência e
 * confiança, e entra em fila de aprovação**. Nunca aplicada por conta própria.
 *
 * O consenso resolveu o elemento apesar de um sinal forte ter falhado. A
 * execução SEGUE com o elemento resolvido (o run não morre por um `data-testid`
 * renomeado), mas a IR não muda: o que sai daqui é uma PROPOSTA — o fingerprint
 * declarado, o que foi observado no elemento resolvido, e o fingerprint que o
 * autor aprovaria se concordar. Automatizar a aprovação seria remover a única
 * etapa em que alguém confere que o motor pegou o elemento CERTO e não um
 * parecido — e "parecido" é como cura silenciosa vira falso negativo.
 */

export interface HealRecord {
  readonly status: "PROPOSED";
  readonly stepId: string;
  /** Id no repositório de elementos, quando o alvo veio de lá. */
  readonly elementRef: string | null;
  readonly declared: Target;
  /** Valores lidos do elemento resolvido, para os sinais que falharam. */
  readonly observed: Partial<Target>;
  /** `declared` com os sinais desatualizados substituídos pelo observado. */
  readonly proposal: Target;
  readonly staleSignals: readonly Signal[];
  readonly matchedSignals: readonly Signal[];
  readonly confidence: number;
  /** Screenshot do elemento resolvido, relativo ao diretório da captura. */
  readonly screenshotPath: string | null;
  readonly proposedAtUtc: string;
}

export function proposeHeal(input: {
  readonly stepId: string;
  readonly elementRef: string | null;
  readonly declared: Target;
  readonly observed: Partial<Target>;
  readonly consensus: Extract<Consensus, { kind: "RESOLVED" }>;
  readonly screenshotPath: string | null;
  readonly nowUtc: string;
}): HealRecord {
  const stale = new Set(input.consensus.failedSignals.flatMap((signal) => keysOf(signal)));
  const proposal: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(input.declared) as [keyof Target, string | number][]) {
    if (!stale.has(key)) proposal[key] = value;
  }
  for (const key of stale) {
    const observed = input.observed[key];
    if (observed !== undefined) proposal[key] = observed;
  }
  return {
    status: "PROPOSED",
    stepId: input.stepId,
    elementRef: input.elementRef,
    declared: input.declared,
    observed: input.observed,
    proposal: proposal,
    staleSignals: input.consensus.failedSignals,
    matchedSignals: input.consensus.matchedSignals,
    confidence: input.consensus.confidence,
    screenshotPath: input.screenshotPath,
    proposedAtUtc: input.nowUtc,
  };
}

function keysOf(signal: Signal): readonly (keyof Target)[] {
  switch (signal) {
    case "testId":
      return ["testId"];
    case "role+name":
      return ["role", "name"];
    case "label":
      return ["label"];
    case "placeholder":
      return ["placeholder"];
    case "text":
      return ["text"];
    case "field":
      return ["field"];
    case "css":
      return ["css"];
  }
}
