import type { Delta, DiffReport } from "@aletheia/diff-engine";

/**
 * Relatório HTML — entregável da Fase 0.
 *
 * Duas regras de conteúdo, não de estilo:
 *
 * 1. A declaração de cobertura (o que NÃO foi validado) aparece ACIMA da lista
 *    de deltas, não num rodapé. Um relatório que só mostra o que encontrou
 *    induz a leitura de que o resto está certo (PA-10, RN-COB-001).
 * 2. Relatório executivo e técnico derivam dos mesmos fatos (RN-COB-004) —
 *    por isso aqui não há número calculado: tudo vem do `DiffReport`.
 *
 * Vive no shim da CLI enquanto for o único consumidor. Quando o shim do GitHub
 * Actions precisar do mesmo HTML, isto sobe para um pacote — não é lógica de
 * decisão, então não conflita com PA-11.
 */
export function renderHtmlReport(report: DiffReport): string {
  const regressions = report.deltas.filter((delta) => delta.classification === "REGRESSION");
  const undetermined = report.deltas.filter((delta) => delta.classification === "UNDETERMINED");
  const noise = report.deltas.filter((delta) => delta.classification === "NOISE");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ALETHEIA — relatório de teste diferencial</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <header class="verdict ${report.verdict.blocking ? "blocking" : "clear"}">
    <p class="eyebrow">Veredito · oráculo ${esc(report.oracle)}</p>
    <h1>${esc(report.verdict.code)}</h1>
    <p>${esc(report.verdict.rationale)}</p>
    <p class="oracle-note">${esc(report.oracleDescription)}</p>
  </header>

  <section>
    <h2>Execução</h2>
    <dl class="grid">
      ${field("runId", report.metadata.runId)}
      ${field("commit", report.metadata.commit)}
      ${field("baseRef", report.metadata.baseRef)}
      ${field("ambiente", report.metadata.environment)}
      ${field("modo de confiança", report.metadata.confidenceMode)}
      ${field("nível de autonomia", `L${report.metadata.autonomyLevel}`)}
      ${field("seed", report.metadata.seed)}
      ${field("versão do runner", report.metadata.runnerVersion)}
      ${field("versão do World Model", report.metadata.worldModelVersion)}
      ${field("versão da IR", report.metadata.irVersion)}
      ${field("iniciado em (UTC)", report.metadata.startedAtUtc)}
      ${field("versão do relatório", report.reportVersion)}
    </dl>
    <dl class="grid">
      ${field("base", `${report.base.label} · ${report.base.baseUrl} · ${report.base.commit ?? "sem commit"}`)}
      ${field("head", `${report.head.label} · ${report.head.baseUrl} · ${report.head.commit ?? "sem commit"}`)}
    </dl>
  </section>

  <section class="coverage">
    <h2>O que <em>não</em> foi validado</h2>
    <p class="hint">Declaração obrigatória (RN-COB-001). Divergência zero não significa aplicação correta.</p>
    <ul>
      ${report.coverage.notes.map((note) => `<li>${esc(note)}</li>`).join("\n      ")}
      ${report.coverage.layersNotValidated
        .map(
          (gap) =>
            `<li><strong>${esc(gap.layer)}</strong> — ${esc(gap.reason)}${
              gap.observations.length > 0
                ? ` <span class="muted">(${gap.observations.length} observação/ões)</span>`
                : ""
            }</li>`,
        )
        .join("\n      ")}
      ${listOrNothing("Observações só na base", report.coverage.observationsOnlyInBase)}
      ${listOrNothing("Observações só no head", report.coverage.observationsOnlyInHead)}
      ${listOrNothing("Observações com diff truncado por orçamento", report.coverage.observationsTruncated)}
    </ul>
    <p class="muted">${report.coverage.observationsCompared} observação(ões) comparada(s).</p>
  </section>

  <section>
    <h2>Resumo</h2>
    <div class="counters">
      ${counter("Regressões", report.summary.byClassification.REGRESSION, "bad")}
      ${counter("Indeterminados", report.summary.byClassification.UNDETERMINED, "warn")}
      ${counter("Ruído suprimido", report.summary.byClassification.NOISE, "muted")}
      ${counter("Total de deltas", report.summary.total, "")}
    </div>
    <div class="counters">
      ${counter("DOM", report.summary.byLayer.DOM, "")}
      ${counter("Rede", report.summary.byLayer.NETWORK, "")}
      ${counter("Normalizações aplicadas", report.normalization.total, "muted")}
      ${counter("Regras de supressão", report.suppression.catalogSize, "muted")}
    </div>
  </section>

  ${deltaSection("Regressões", regressions, "Atingiram o limiar. Bloqueiam o gate.")}
  ${deltaSection(
    "Indeterminados",
    undetermined,
    "Divergem da base mas não atingem o limiar. Nunca bloqueiam (RN-ORC-009) — requerem triagem. Rotular estes casos é o que gera as regras de supressão com evidência.",
  )}
  ${deltaSection("Ruído suprimido", noise, "Classificados como NOISE por regra de supressão. Listados para auditoria.")}

  <section>
    <h2>Normalização aplicada</h2>
    <p class="hint">Normalizar é deixar de comparar. Números altos merecem investigação.</p>
    ${renderCounts(report.normalization.byRule)}
  </section>
</main>
</body>
</html>
`;
}

function deltaSection(title: string, deltas: readonly Delta[], hint: string): string {
  if (deltas.length === 0) {
    return `<section><h2>${esc(title)} <span class="muted">(0)</span></h2><p class="hint">${esc(hint)}</p></section>`;
  }

  const rows = deltas
    .map(
      (delta) => `<tr>
      <td><span class="sev sev-${esc(delta.severity)}">${esc(delta.severity)}</span></td>
      <td><code>${esc(delta.kind)}</code></td>
      <td class="path"><code>${esc(delta.path)}</code><br><span class="muted">${esc(delta.observationId)}</span></td>
      <td class="value">${renderValue(delta.before)}</td>
      <td class="value">${renderValue(delta.after)}</td>
      <td class="muted">${delta.score}${delta.suppressedBy === null ? "" : `<br>${esc(delta.suppressedBy)}`}</td>
    </tr>`,
    )
    .join("\n");

  return `<section>
    <h2>${esc(title)} <span class="muted">(${deltas.length})</span></h2>
    <p class="hint">${esc(hint)}</p>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Severidade</th><th>Tipo</th><th>Onde</th><th>Base</th><th>Head</th><th>Score</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>`;
}

function renderCounts(counts: Readonly<Record<string, number>>): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) return `<p class="muted">Nenhuma normalização foi necessária.</p>`;
  return `<div class="table-scroll"><table>
    <thead><tr><th>Regra</th><th>Ocorrências</th></tr></thead>
    <tbody>${entries
      .map(([rule, count]) => `<tr><td><code>${esc(rule)}</code></td><td>${count}</td></tr>`)
      .join("")}</tbody>
  </table></div>`;
}

function listOrNothing(label: string, values: readonly string[]): string {
  if (values.length === 0) return "";
  return `<li><strong>${esc(label)}</strong>: ${values.map((value) => `<code>${esc(value)}</code>`).join(", ")}</li>`;
}

function counter(label: string, value: number, tone: string): string {
  return `<div class="counter ${tone}"><span class="n">${value}</span><span class="l">${esc(label)}</span></div>`;
}

function field(label: string, value: string | null): string {
  return `<div><dt>${esc(label)}</dt><dd>${value === null ? '<span class="muted">não disponível nesta fase</span>' : esc(value)}</dd></div>`;
}

function renderValue(value: string | null): string {
  if (value === null) return '<span class="muted">—</span>';
  return `<code>${esc(value)}</code>`;
}

/**
 * Escape obrigatório: `before`/`after` carregam conteúdo da aplicação do
 * cliente. Injetar isso cru no HTML seria transformar o relatório em vetor.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STYLE = `
:root { color-scheme: light dark; --bg:#fff; --fg:#16181d; --muted:#6b7280; --line:#e5e7eb; --bad:#b42318; --badbg:#fef3f2; --warn:#b54708; --warnbg:#fffaeb; --ok:#067647; --okbg:#ecfdf3; }
@media (prefers-color-scheme: dark) { :root { --bg:#0f1115; --fg:#e6e8ec; --muted:#9aa1ac; --line:#252a33; --badbg:#2a1414; --warnbg:#2a2011; --okbg:#0f2318; --bad:#f97066; --warn:#f79009; --ok:#47cd89; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
main { max-width:1100px; margin:0 auto; padding:32px 20px 80px; }
h1 { font-size:24px; margin:4px 0 8px; letter-spacing:-.01em; }
h2 { font-size:16px; margin:36px 0 8px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
code { font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; overflow-wrap:anywhere; }
.eyebrow { margin:0; font-size:12px; text-transform:uppercase; letter-spacing:.08em; opacity:.75; }
.verdict { border:1px solid var(--line); border-radius:10px; padding:20px 22px; }
.verdict.blocking { background:var(--badbg); border-color:var(--bad); }
.verdict.clear { background:var(--okbg); border-color:var(--ok); }
.verdict p { margin:6px 0 0; }
.oracle-note { color:var(--muted); font-size:13px; }
.coverage { border:1px dashed var(--line); border-radius:10px; padding:4px 22px 18px; background:var(--warnbg); }
.coverage ul { margin:8px 0; padding-left:20px; }
.coverage li { margin:4px 0; }
.hint { color:var(--muted); font-size:13px; margin:0 0 10px; }
.muted { color:var(--muted); }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:10px 20px; margin:10px 0; }
.grid dt { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
.grid dd { margin:2px 0 0; overflow-wrap:anywhere; }
.counters { display:flex; flex-wrap:wrap; gap:12px; margin:12px 0; }
.counter { border:1px solid var(--line); border-radius:8px; padding:12px 16px; min-width:130px; }
.counter .n { display:block; font-size:26px; font-weight:600; }
.counter .l { font-size:12px; color:var(--muted); }
.counter.bad .n { color:var(--bad); } .counter.warn .n { color:var(--warn); }
.table-scroll { overflow-x:auto; border:1px solid var(--line); border-radius:8px; }
table { border-collapse:collapse; width:100%; font-size:13px; }
th { text-align:left; padding:9px 12px; border-bottom:1px solid var(--line); font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
td { padding:9px 12px; border-bottom:1px solid var(--line); vertical-align:top; }
tr:last-child td { border-bottom:0; }
.path { min-width:260px; } .value { max-width:280px; }
.sev { font-size:11px; font-weight:600; padding:2px 7px; border-radius:99px; border:1px solid currentColor; white-space:nowrap; }
.sev-CRITICAL, .sev-HIGH { color:var(--bad); } .sev-MEDIUM { color:var(--warn); } .sev-LOW { color:var(--muted); }
`;
