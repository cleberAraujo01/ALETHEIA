/**
 * Portão de build do catálogo de supressão.
 *
 * Roda em `pnpm suppression:validate` e deve rodar no CI do próprio projeto:
 * uma regra de supressão sem evidência não entra na main.
 */
import { SUPPRESSION_CATALOG } from "./catalog.js";
import { validateSuppressionRules } from "./rule.js";

const issues = validateSuppressionRules(SUPPRESSION_CATALOG);

if (issues.length > 0) {
  process.stderr.write(
    `catálogo de supressão inválido — ${issues.length} problema(s):\n${issues
      .map((issue) => `  ${issue.ruleId}: ${issue.problem}`)
      .join("\n")}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `catálogo de supressão válido — ${SUPPRESSION_CATALOG.length} regra(s)\n`,
);
