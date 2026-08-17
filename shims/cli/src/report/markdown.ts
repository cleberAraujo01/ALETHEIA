import type { Delta, DeltaGroup, DiffReport } from "@aletheia/diff-engine";

/**
 * Comentário de PR — o que o desenvolvedor lê primeiro, e muitas vezes a única
 * coisa que lê. As mesmas duas regras do HTML (RN-COB-004: mesmos fatos;
 * PA-10: o que NÃO foi validado aparece, não some num rodapé), mais uma que é
 * do meio: **cabe numa tela**. Um comentário com 135 linhas é ignorado; um com
 * 10 grupos e "+ N" é lido.
 *
 * Nada aqui é calculado: tudo vem do `DiffReport`. Nada aqui é narrado por
 * modelo (PA-01) — quando o Narrator existir (Fase 4), ele explica; este
 * comentário continua sendo o fato.
 */

export interface PrCommentOptions {
  /** Quantos grupos de regressão listar antes de resumir o resto. */
  readonly maxGroups?: number;
  /** Onde estão os artefatos completos, se o shim os publicou. */
  readonly artifactsHint?: string | null;
}

const DEFAULT_MAX_GROUPS = 10;

/** Marcador estável para o shim achar e atualizar o próprio comentário. */
export const PR_COMMENT_MARKER = "<!-- aletheia:run -->";

export function renderPrComment(report: DiffReport, options: PrCommentOptions = {}): string {
  const maxGroups = options.maxGroups ?? DEFAULT_MAX_GROUPS;
  const regressions = report.groups.filter((group) => group.classification === "REGRESSION");
  const byId = new Map(report.deltas.map((delta) => [delta.deltaId, delta]));

  const lines: string[] = [PR_COMMENT_MARKER];

  lines.push(
    `## ALETHEIA · ${report.verdict.blocking ? "🔴" : "🟢"} ${report.verdict.code}${report.verdict.blocking ? " — bloqueia" : ""}`,
    "",
    report.verdict.rationale,
    "",
    `Oráculo **${report.oracle}** — teste diferencial: base \`${report.base.label}\`${commitOf(report.base.commit)} × head \`${report.head.label}\`${commitOf(report.head.commit)}. ` +
      `Modo de confiança **${report.metadata.confidenceMode}**${confidenceNote(report.metadata.confidenceMode)}.`,
    "",
  );

  if (regressions.length > 0) {
    lines.push(
      `### Regressões — ${report.summary.byClassification.REGRESSION} delta(s) em ${regressions.length} grupo(s)`,
      "",
      "Um grupo é uma causa provável: mesma camada, tipo e lugar estrutural, em qualquer página.",
      "",
      "| Sev | Tipo | Onde | Deltas | Páginas | Exemplo |",
      "|---|---|---|---|---|---|",
    );
    for (const group of regressions.slice(0, maxGroups)) {
      lines.push(groupRow(group, byId));
    }
    if (regressions.length > maxGroups) {
      lines.push(
        "",
        `… e mais **${regressions.length - maxGroups} grupo(s)** de regressão no relatório completo.`,
      );
    }
    lines.push("");
  }

  const undetermined = report.summary.byClassification.UNDETERMINED;
  if (undetermined > 0) {
    lines.push(
      `**${undetermined} delta(s) indeterminado(s)** em ${report.summary.groups.UNDETERMINED} grupo(s) — divergem da base sem atingir o limiar. Não bloqueiam (RN-ORC-009); pedem triagem, e rotulá-los é o que alimenta a supressão aprendida.`,
      "",
    );
  }

  lines.push("### O que **não** foi validado", "");
  for (const note of report.coverage.notes) lines.push(`- ${note}`);
  for (const gap of report.coverage.layersNotValidated) {
    lines.push(
      `- **${gap.layer}** — ${gap.reason}${gap.observations.length > 0 ? ` (${gap.observations.length} observação/ões)` : ""}`,
    );
  }
  if (report.coverage.observationsOnlyInBase.length > 0) {
    lines.push(`- Só na base: ${report.coverage.observationsOnlyInBase.map(code).join(", ")}`);
  }
  if (report.coverage.observationsOnlyInHead.length > 0) {
    lines.push(`- Só no head: ${report.coverage.observationsOnlyInHead.map(code).join(", ")}`);
  }
  if (report.coverage.observationsTruncated.length > 0) {
    lines.push(
      `- Diff truncado por orçamento em: ${report.coverage.observationsTruncated.map(code).join(", ")}`,
    );
  }
  lines.push("", `${report.coverage.observationsCompared} observação(ões) comparada(s).`, "");

  lines.push(
    "<details><summary>Resumo e execução</summary>",
    "",
    `- deltas: ${report.summary.total} · regressões ${report.summary.byClassification.REGRESSION} · indeterminados ${undetermined} · ruído suprimido ${report.summary.byClassification.NOISE}`,
    `- camadas: DOM ${report.summary.byLayer.DOM} · rede ${report.summary.byLayer.NETWORK} · visual ${report.summary.byLayer.VISUAL} · console ${report.summary.byLayer.CONSOLE} · banco ${report.summary.byLayer.DATABASE}`,
    `- normalizações aplicadas: ${report.normalization.total} · regras de supressão em vigor: ${report.suppression.activeRuleIds.length}${report.suppression.activeRuleIds.length > 0 ? ` (${report.suppression.activeRuleIds.join(", ")})` : ""}`,
    `- runId \`${report.metadata.runId}\` · commit ${code(report.metadata.commit ?? "—")} · baseRef ${code(report.metadata.baseRef ?? "—")} · ambiente ${code(report.metadata.environment)} · seed ${code(report.metadata.seed)}`,
    `- runner ${code(report.metadata.runnerVersion)} · browser ${code(report.metadata.browserVersion ?? "—")} · relatório ${code(report.reportVersion)}`,
  );
  if (options.artifactsHint !== undefined && options.artifactsHint !== null) {
    lines.push(`- artefatos completos: ${options.artifactsHint}`);
  }
  lines.push("", "</details>", "");

  return `${lines.join("\n")}\n`;
}

function groupRow(group: DeltaGroup, byId: ReadonlyMap<string, Delta>): string {
  const first = group.deltaIds.map((id) => byId.get(id)).find((delta) => delta !== undefined);
  const example =
    first === undefined ? "—" : `${cell(first.before ?? "—")} → ${cell(first.after ?? "—")}`;
  return `| ${group.severity} | \`${group.kind}\` | ${cell(group.pathSkeleton)} | ${group.deltaIds.length} | ${group.observationIds.length} | ${example} |`;
}

/** Célula de tabela Markdown: sem quebra de linha, sem `|` cru, curta. */
function cell(value: string): string {
  const flat = value.replace(/\s+/g, " ").replace(/\|/g, "\\|").replace(/`/g, "'").trim();
  return `\`${flat.length > 90 ? `${flat.slice(0, 90)}…` : flat}\``;
}

function code(value: string): string {
  return `\`${value.replace(/`/g, "'")}\``;
}

function commitOf(commit: string | null): string {
  return commit === null ? "" : ` (${code(commit.slice(0, 12))})`;
}

function confidenceNote(mode: DiffReport["metadata"]["confidenceMode"]): string {
  if (mode === "ISOLATED") return "";
  if (mode === "PARTITIONED") return " (isolamento lógico; autonomia máxima L4)";
  return " (ambientes compartilhados, sem isolamento declarado; autonomia máxima L3 — RN-EXE-007)";
}
