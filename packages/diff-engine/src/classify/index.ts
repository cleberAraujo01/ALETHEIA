import type { Calibration } from "../score/calibration.js";
import type { Classification } from "../types/delta.js";

/**
 * Classificação — estágio 6 do pipeline. RN-ORC-009.
 *
 * Determinístico por completo. Nenhuma chamada de modelo participa desta
 * decisão, hoje nem depois: quando o Narrator existir (Fase 4), ele vai
 * **explicar** a classificação, nunca produzi-la (PA-01, RN-ORC-002).
 *
 * Sobre `INTENDED_CHANGE`: esta classificação exige uma fonte de intenção —
 * requisito (O1), diff de código (O2) ou contrato (O3). Nenhuma existe na
 * Fase 0. Emitir `INTENDED_CHANGE` aqui seria afirmar conhecer a intenção do
 * desenvolvedor a partir de nada. Todo delta que não atinge o limiar cai em
 * `UNDETERMINED`, que nunca bloqueia — e o relatório diz quantos são, para que
 * o volume de indeterminados seja um número visível e não uma omissão.
 */
export function classify(
  score: number,
  suppressedBy: string | null,
  calibration: Calibration,
): Classification {
  if (suppressedBy !== null) return "NOISE";
  if (score >= calibration.regressionThreshold) return "REGRESSION";
  return "UNDETERMINED";
}
