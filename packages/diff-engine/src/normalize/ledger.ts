/**
 * Livro-razão de normalização.
 *
 * Toda normalização aplicada é contada por regra. O relatório mostra o total.
 *
 * Isto não é telemetria decorativa: normalizar é esconder informação, e
 * esconder informação em silêncio é como um produto de qualidade produz falso
 * negativo (PA-10). Se uma regra dispara 40.000 vezes numa execução, alguém
 * precisa ver esse número e perguntar por quê.
 */
export interface NormalizationLedger {
  record(ruleId: string, times?: number): void;
  counts(): Readonly<Record<string, number>>;
  total(): number;
}

export function createLedger(): NormalizationLedger {
  const counts = new Map<string, number>();
  return {
    record(ruleId: string, times = 1): void {
      counts.set(ruleId, (counts.get(ruleId) ?? 0) + times);
    },
    counts(): Readonly<Record<string, number>> {
      return Object.fromEntries([...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
    },
    total(): number {
      let sum = 0;
      for (const value of counts.values()) sum += value;
      return sum;
    },
  };
}
