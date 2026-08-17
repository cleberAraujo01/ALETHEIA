import type { Signal, WeightedSignal } from "./fingerprint.js";

/**
 * Consenso ponderado — §12.2: "todas as estratégias pontuam candidatos;
 * escolha por consenso".
 *
 * Este módulo não toca browser. Quem coleta candidatos (o runner, com
 * Playwright) entrega, por sinal, a lista de CHAVES de elemento que aquele
 * sinal casou — a chave é qualquer identidade estável dentro da página (o
 * runner usa XPath absoluto). Aqui só se soma peso e se decide. Separar assim
 * é o que deixa o consenso testável em milissegundos, sem página, e auditável
 * linha a linha (PA-01: código determinístico dispõe).
 *
 * As três decisões possíveis, e nenhuma delas é "escolhe o primeiro":
 *
 *   RESOLVED   um candidato com pontuação ≥ `minScore` e à frente do segundo
 *              por ≥ `margin`. `healed` quando algum sinal FORTE declarado não
 *              casou o vencedor — o fingerprint está desatualizado e o runner
 *              deve propor cura (RN-EXE-011), nunca aplicá-la.
 *   AMBIGUOUS  há candidatos, mas o topo empata, está abaixo do mínimo, ou
 *              seria uma CURA SEM CORROBORAÇÃO (abaixo).
 *   NOT_FOUND  nenhum sinal casou nada.
 *
 * CURA SEM CORROBORAÇÃO NÃO RESOLVE. O corpus de mutações mostrou o caso: o
 * botão sumiu da página, mas `text: "Entrar"` casou o `<h1>Entrar</h1>` — e o
 * consenso "curava" para um cabeçalho. É o "parecido" que a cura silenciosa
 * transforma em falso negativo. Quando os sinais fortes falharam, o vencedor
 * precisa de ≥ 2 sinais concordando OU do sinal mais forte declarado; um sinal
 * secundário sozinho é ambiguidade para um humano olhar, não resolução.
 */

export interface SignalMatches {
  readonly signal: Signal;
  readonly weight: number;
  /** Chaves dos elementos que este sinal casou. Vazio = sinal não casou nada. */
  readonly candidateKeys: readonly string[];
}

export interface ConsensusOptions {
  /** Pontuação mínima do vencedor quando há mais de um sinal declarado. HIPÓTESE. */
  readonly minScore: number;
  /** Distância mínima para o segundo colocado. HIPÓTESE. */
  readonly margin: number;
  /** Peso a partir do qual um sinal declarado que falhou caracteriza cura. HIPÓTESE. */
  readonly strongSignalWeight: number;
  /** Desempate explícito do autor da jornada. */
  readonly nth?: number;
}

export const DEFAULT_CONSENSUS: ConsensusOptions = {
  minScore: 0.6,
  margin: 0.2,
  strongSignalWeight: 0.7,
};

export interface Candidate {
  readonly key: string;
  readonly score: number;
  readonly matchedSignals: readonly Signal[];
}

export type Consensus =
  | {
      readonly kind: "RESOLVED";
      readonly key: string;
      readonly score: number;
      /** score / soma dos pesos declarados — 1.0 é unanimidade. */
      readonly confidence: number;
      readonly matchedSignals: readonly Signal[];
      readonly failedSignals: readonly Signal[];
      /** Sinal forte declarado falhou: fingerprint desatualizado, propor cura. */
      readonly healed: boolean;
      readonly candidates: readonly Candidate[];
    }
  | {
      readonly kind: "AMBIGUOUS";
      readonly candidates: readonly Candidate[];
      readonly reason: string;
    }
  | { readonly kind: "NOT_FOUND"; readonly triedSignals: readonly Signal[] };

export function decide(
  matches: readonly SignalMatches[],
  options: ConsensusOptions = DEFAULT_CONSENSUS,
): Consensus {
  const totalWeight = matches.reduce((sum, entry) => sum + entry.weight, 0);
  const scores = new Map<string, { score: number; matched: Signal[] }>();

  for (const entry of matches) {
    // Um sinal que casa muitos elementos ainda vota em cada um — mas é o
    // consenso com os outros que separa o certo. Sinal sozinho e promíscuo não
    // atinge o mínimo.
    for (const key of new Set(entry.candidateKeys)) {
      const current = scores.get(key) ?? { score: 0, matched: [] };
      current.score += entry.weight;
      current.matched.push(entry.signal);
      scores.set(key, current);
    }
  }

  const candidates: Candidate[] = [...scores.entries()]
    .map(([key, value]) => ({ key, score: round(value.score), matchedSignals: value.matched }))
    // Determinístico: pontuação, depois chave.
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));

  if (candidates.length === 0) {
    return { kind: "NOT_FOUND", triedSignals: matches.map((entry) => entry.signal) };
  }

  // `nth` do autor: entre os candidatos que casaram o sinal mais forte que
  // casou alguma coisa, na ordem do documento (a ordem em que o runner os
  // entregou), pega o enésimo. É desempate declarado, não adivinhação.
  if (options.nth !== undefined) {
    const strongest = matches
      .filter((entry) => entry.candidateKeys.length > 0)
      .sort((a, b) => b.weight - a.weight)[0];
    const pool = strongest?.candidateKeys ?? [];
    const key = pool[options.nth];
    if (key === undefined) {
      return {
        kind: "AMBIGUOUS",
        candidates,
        reason: `nth=${options.nth} fora do alcance: ${pool.length} candidato(s) no sinal mais forte`,
      };
    }
    const chosen = candidates.find((candidate) => candidate.key === key);
    return resolved(
      chosen ?? { key, score: 0, matchedSignals: [] },
      matches,
      totalWeight,
      candidates,
      options,
    );
  }

  const [winner, runnerUp] = candidates;
  if (winner === undefined) {
    return { kind: "NOT_FOUND", triedSignals: matches.map((entry) => entry.signal) };
  }
  // O mínimo protege contra sinal FRACO vencendo no meio de vários que
  // falharam. Um fingerprint com um único sinal declarado casando um único
  // elemento é identidade legítima (`{ field: "username" }` num formulário sem
  // rótulo — o ParaBank real): não há "vários" para ele estar perdido no meio.
  if (matches.length > 1 && winner.score < options.minScore) {
    return {
      kind: "AMBIGUOUS",
      candidates,
      reason: `melhor candidato pontua ${winner.score} < mínimo ${options.minScore}`,
    };
  }
  if (runnerUp !== undefined && winner.score - runnerUp.score < options.margin) {
    return {
      kind: "AMBIGUOUS",
      candidates,
      reason: `empate: ${winner.score} vs ${runnerUp.score} (margem mínima ${options.margin}); use nth`,
    };
  }
  return resolved(winner, matches, totalWeight, candidates, options);
}

function resolved(
  winner: Candidate,
  matches: readonly SignalMatches[],
  totalWeight: number,
  candidates: readonly Candidate[],
  options: ConsensusOptions,
): Consensus {
  const failed = matches
    .filter((entry) => !winner.matchedSignals.includes(entry.signal))
    .map((entry) => entry.signal);
  const healed = matches.some(
    (entry) => failed.includes(entry.signal) && entry.weight >= options.strongSignalWeight,
  );
  if (healed) {
    const strongest = [...matches].sort((a, b) => b.weight - a.weight)[0]?.signal;
    const corroborated =
      winner.matchedSignals.length >= 2 ||
      (strongest !== undefined && winner.matchedSignals.includes(strongest));
    if (!corroborated) {
      return {
        kind: "AMBIGUOUS",
        candidates,
        reason:
          `cura sem corroboração: só ${winner.matchedSignals.join("+")} casou e os sinais fortes ` +
          `(${failed.join(", ")}) falharam — pode ser outro elemento parecido`,
      };
    }
  }
  return {
    kind: "RESOLVED",
    key: winner.key,
    score: winner.score,
    confidence: totalWeight > 0 ? round(winner.score / totalWeight) : 0,
    matchedSignals: winner.matchedSignals,
    failedSignals: failed,
    healed,
    candidates,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export type { WeightedSignal };
