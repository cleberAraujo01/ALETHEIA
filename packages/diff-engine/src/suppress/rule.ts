import type { RawDelta } from "../diff/types.js";

/**
 * Regras de supressão — estágio 4 do pipeline.
 *
 * Supressão é o mecanismo mais perigoso do produto. Suprimir ruído melhora o
 * relatório de forma imediatamente visível; suprimir sinal produz **falso
 * negativo silencioso**, que ninguém percebe e que é pior que falso positivo
 * (PA-10). Por isso a barreira é estrutural, não cultural:
 *
 *   - Toda regra exige no mínimo `MIN_EVIDENCE` casos reais rotulados NOISE
 *     por um humano (§6.4 do CLAUDE.md, RN-ORC-010).
 *   - `pnpm suppression:validate` falha o build se qualquer regra não cumprir.
 *   - Toda supressão aplicada aparece no relatório com o id da regra. Um delta
 *     suprimido não desaparece: ele é classificado como NOISE e continua
 *     visível para quem quiser auditar.
 */

/** Um caso real, rotulado por um humano, que justifica a existência da regra. */
export interface EvidenceRef {
  /** Execução em que o delta foi observado — permite reconstituir (PA-12). */
  readonly runId: string;
  readonly deltaId: string;
  /**
   * Identidade do PAR de capturas (captura base e head, cada uma com o instante
   * em que foi feita). É o que distingue "o mesmo par re-diffado" (não conta
   * de novo) de "outro par com o mesmo caminho" (conta): o `deltaId` é
   * função só de camada, tipo, observação e caminho, e por isso cinco builds
   * distintas produzem o mesmo `deltaId` para o mesmo id gerado. Ausente em
   * evidência gravada antes de existir; aí a dedup recua para `deltaId`.
   */
  readonly pairId?: string;
  /** Quem rotulou como NOISE. Supressão nunca é anônima. */
  readonly labeledBy: string;
  readonly labeledAtUtc: string;
  readonly note: string;
}

export interface SuppressionRule {
  /** `SUP-<domínio>-<n>`. */
  readonly id: string;
  readonly description: string;
  /**
   * `null` = vale para todos os projetos. Uma regra global precisa de evidência
   * de mais de um projeto — ruído de uma aplicação não é ruído de outra.
   */
  readonly projectId: string | null;
  readonly evidence: readonly EvidenceRef[];
  matches(delta: RawDelta): boolean;
}

export const MIN_EVIDENCE = 3;

export interface RuleValidationIssue {
  readonly ruleId: string;
  readonly problem: string;
}

export function validateSuppressionRules(
  rules: readonly SuppressionRule[],
): readonly RuleValidationIssue[] {
  const issues: RuleValidationIssue[] = [];
  const seen = new Set<string>();

  for (const rule of rules) {
    if (seen.has(rule.id)) {
      issues.push({ ruleId: rule.id, problem: "id duplicado" });
    }
    seen.add(rule.id);

    if (rule.evidence.length < MIN_EVIDENCE) {
      issues.push({
        ruleId: rule.id,
        problem: `evidência insuficiente: ${rule.evidence.length} de ${MIN_EVIDENCE} casos reais rotulados`,
      });
    }

    const distinctRuns = new Set(rule.evidence.map((entry) => entry.runId));
    if (rule.evidence.length >= MIN_EVIDENCE && distinctRuns.size < MIN_EVIDENCE) {
      issues.push({
        ruleId: rule.id,
        problem: "evidência concentrada: os casos precisam vir de execuções distintas",
      });
    }

    if (rule.description.trim().length < 20) {
      issues.push({ ruleId: rule.id, problem: "descrição insuficiente para auditoria" });
    }
  }

  return issues;
}

export interface SuppressionResult {
  readonly suppressedBy: string | null;
}

export function applySuppression(
  delta: RawDelta,
  rules: readonly SuppressionRule[],
): SuppressionResult {
  for (const rule of rules) {
    if (rule.matches(delta)) {
      return { suppressedBy: rule.id };
    }
  }
  return { suppressedBy: null };
}
