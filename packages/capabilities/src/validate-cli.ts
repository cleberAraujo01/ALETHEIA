/**
 * `pnpm capabilities:validate [caminho]` — §6.1 do CLAUDE.md, passo 3.
 *
 * Roda a validação estática sobre todo YAML do caminho (default: `capabilities/`
 * na raiz, se existir) e reprova o build se qualquer capability tiver problema.
 * Imprime, para cada uma, tabelas e colunas referenciadas — é o que quem aprova
 * confere contra a allowlist. O que ele NÃO faz está no cabeçalho de
 * `validate.ts`: não é AST, não roda EXPLAIN.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { auditCatalog } from "./catalog.js";

const target = resolve(process.argv[2] ?? "capabilities");
if (!existsSync(target)) {
  process.stdout.write(`\n  nenhum catálogo em ${target} — nada a validar\n\n`);
  process.exit(0);
}

const reports = auditCatalog(target);
let problems = 0;
process.stdout.write(
  `\n  capabilities — validação estática (léxica, não AST) de ${reports.length} arquivo(s)\n\n`,
);
for (const report of reports) {
  if (report.spec === null || report.validation === null) {
    problems += 1;
    process.stdout.write(`  ✗ ${report.file}\n      ${report.parseError ?? "erro desconhecido"}\n`);
    continue;
  }
  const ok = report.validation.issues.length === 0;
  if (!ok) problems += 1;
  process.stdout.write(
    `  ${ok ? "✓" : "✗"} ${report.file}  ${report.spec.name} v${report.spec.version}  ${report.spec.operation}  ${report.spec.approval.status}\n` +
      `      tabelas: ${report.validation.referencedTables.join(", ") || "—"}  ·  colunas: ${report.validation.referencedColumns.join(", ") || "—"}\n`,
  );
  for (const issue of report.validation.issues) process.stdout.write(`      ✗ ${issue.problem}\n`);
  for (const note of report.validation.notes) process.stdout.write(`      · ${note}\n`);
}
process.stdout.write(
  `\n  ${problems === 0 ? "catálogo válido" : `${problems} capability(ies) com problema`}\n\n`,
);
process.exit(problems === 0 ? 0 : 1);
