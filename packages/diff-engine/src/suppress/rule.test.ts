import { describe, expect, it } from "vitest";

import { SUPPRESSION_CATALOG } from "./catalog.js";
import { MIN_EVIDENCE, validateSuppressionRules, type SuppressionRule } from "./rule.js";

const evidence = (index: number): SuppressionRule["evidence"][number] => ({
  runId: `run_${index}`,
  deltaId: `delta_${index}`,
  labeledBy: "qa@cliente.example",
  labeledAtUtc: "2026-01-10T12:00:00.000Z",
  note: "banner de cookies renderiza em ordem não determinística",
});

const rule = (overrides: Partial<SuppressionRule> = {}): SuppressionRule => ({
  id: "SUP-DOM-001",
  description: "Ordem do banner de consentimento varia entre execuções da mesma build",
  projectId: "proj_1",
  evidence: [evidence(1), evidence(2), evidence(3)],
  matches: () => false,
  ...overrides,
});

describe("catálogo de supressão", () => {
  it("nasce vazio — regra sem corpus é palpite sobre o que é ruído", () => {
    expect(SUPPRESSION_CATALOG).toHaveLength(0);
    expect(validateSuppressionRules(SUPPRESSION_CATALOG)).toEqual([]);
  });

  it("aceita regra com evidência suficiente e distinta", () => {
    expect(validateSuppressionRules([rule()])).toEqual([]);
  });

  it(`recusa regra com menos de ${MIN_EVIDENCE} casos rotulados`, () => {
    const issues = validateSuppressionRules([rule({ evidence: [evidence(1), evidence(2)] })]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.problem).toContain("evidência insuficiente");
  });

  it("recusa evidência concentrada numa única execução", () => {
    // Três deltas do mesmo run são um caso, não três.
    const issues = validateSuppressionRules([
      rule({ evidence: [evidence(1), evidence(1), evidence(1)] }),
    ]);
    expect(issues.map((issue) => issue.problem)).toContain(
      "evidência concentrada: os casos precisam vir de execuções distintas",
    );
  });

  it("recusa descrição insuficiente para auditoria", () => {
    const issues = validateSuppressionRules([rule({ description: "ruído" })]);
    expect(issues.map((issue) => issue.problem)).toContain("descrição insuficiente para auditoria");
  });

  it("recusa ids duplicados", () => {
    const issues = validateSuppressionRules([rule(), rule()]);
    expect(issues.map((issue) => issue.problem)).toContain("id duplicado");
  });
});
