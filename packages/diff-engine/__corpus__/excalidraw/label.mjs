#!/usr/bin/env node
/**
 * Rotulagem do corpus `excalidraw` — um rotulador para os cinco PRs e o piso.
 *
 *   node label.mjs <report.json> <labels.json>
 *
 * O PR vem de `report.head.label` (`pr-<n>`); a natureza dele, de `prs.mjs`.
 * Como nos outros corpora, a rotulagem NÃO lê `classification`/`severity`/
 * `score`: olha o que mudou e confronta com o que se sabe do PR.
 *
 * Aqui o par é EXATO (base = merge-base do PR), então "drift" não existe e
 * o espaço de rótulos é menor que no vite-docs:
 *
 *  - telemetria de terceiro (`sentry.io`, `simpleanalyticscdn.com`): NOISE.
 *    Sessão, timestamp e fingerprint do browser mudam a cada carga da MESMA
 *    build — está no piso — e vão se repetir em todo PR;
 *  - id gerado por render (`<token>-dialog-title` no `id` e no
 *    `aria-labelledby` dos cabeçalhos de seção): NOISE. O token muda a cada
 *    carga; o que fica depois dele é igual. Também está no piso;
 *  - rede da própria aplicação (`/assets/index-<hash>.*`, o HTML de `/`):
 *    INTENDED_CHANGE — outra build, hash de conteúdo. É onde se viu que o
 *    hash do Vite sem dígito (`DVNY-aUO`) escapa de `NORM-NET-007` de um
 *    lado só (§10 da medição);
 *  - DOM/pixel numa observação em que o PR é `visivel`: INTENDED_CHANGE,
 *    com a nota dizendo qual PR;
 *  - qualquer outra coisa: NOISE. Fechamento para baixo — um PR que não toca
 *    a UI da jornada não pode ter delta de DOM que seja dele; se apareceu,
 *    é a aplicação não sendo determinística ou o motor, e o rótulo diz isso.
 *
 * O piso (mesma base capturada duas vezes) é todo NOISE por construção e é a
 * fonte mais pura de evidência para a supressão aprendida.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PISO_SHA, PRS } from "./prs.mjs";

const [reportPath, outPath] = process.argv.slice(2);
if (reportPath === undefined || outPath === undefined) {
  process.stderr.write("uso: node label.mjs <report.json> <labels.json>\n");
  process.exit(2);
}

const report = JSON.parse(await readFile(resolve(reportPath), "utf8"));
const PISO = { tipo: "PISO", titulo: "mesma base, duas capturas", visivel: [] };
const numero = /^pr-(\d+)$/.exec(report.head.label ?? "")?.[1];
const pr =
  report.head.label === `base-${PISO_SHA}-rerun`
    ? PISO
    : numero === undefined
      ? undefined
      : PRS[numero];
if (pr === undefined) {
  process.stderr.write(
    `  head.label "${report.head.label}" não é PR do corpus (${Object.keys(PRS).join(", ")}) nem base-${PISO_SHA}-rerun\n`,
  );
  process.exit(2);
}

const s = (v) => String(v ?? "");
const TELEMETRY = /sentry\.io|simpleanalyticscdn\.com/;
const isTelemetry = (d) => d.layer === "NETWORK" && TELEMETRY.test(d.path);
const isOwnBuild = (d) =>
  d.layer === "NETWORK" &&
  !TELEMETRY.test(d.path) &&
  (/\/assets\//.test(d.path) || /^GET \/#\d+ response$/.test(d.path));

/**
 * `2SOrqxauv1tg-zzrooo5k-dialog-title`, `Nks0yUpTwKcjxo_D_98do-dialog-title` →
 * `dialog-title`. Segmento aleatório é o que tem dígito ou `_` (alfabeto do
 * nanoid) ou é longo demais para ser palavra; `canvasActions` fica.
 */
const aleatorio = (seg) => /\d|_/.test(seg) || seg.length >= 16;
const semToken = (v) => {
  const partes = s(v).split("-");
  while (partes.length > 1 && aleatorio(partes[0])) partes.shift();
  return partes.join("-");
};
const isGeneratedId = (d) =>
  d.layer === "DOM" &&
  d.kind === "DOM_ATTRIBUTE_CHANGED" &&
  /@(id|aria-labelledby|aria-describedby|aria-controls|for)$/.test(d.path) &&
  s(d.before) !== s(d.after) &&
  semToken(d.before) !== s(d.before) &&
  semToken(d.before) === semToken(d.after);

const labels = {};
const contagem = { REGRESSION: 0, INTENDED_CHANGE: 0, NOISE: 0 };

for (const delta of report.deltas) {
  const { label, note } = rotular(delta);
  labels[delta.deltaId] = { label, note };
  contagem[label] += 1;
}

await writeFile(
  resolve(outPath),
  `${JSON.stringify(
    {
      _origem: `Gerado por packages/diff-engine/__corpus__/excalidraw/label.mjs para ${pr.tipo === "PISO" ? "o piso (base × base-rerun)" : `o PR #${numero} (${pr.tipo})`}, a partir de prs.mjs. Não consulta o veredito do motor.`,
      labels,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

process.stdout.write(
  `\n  ${pr.tipo === "PISO" ? "piso" : `PR #${numero}`} (${pr.tipo}): ${report.deltas.length} delta(s) — ` +
    `${contagem.REGRESSION} regressão, ${contagem.INTENDED_CHANGE} mudança pretendida, ${contagem.NOISE} ruído\n\n`,
);

function rotular(delta) {
  if (isTelemetry(delta)) {
    return {
      label: "NOISE",
      note:
        "telemetria de terceiro (Sentry, Simple Analytics): sessão, timestamp e fingerprint do browser " +
        "mudam a cada carga da mesma build. AO SUPRIMIR, telemetria que pare de ser enviada passa despercebida — e é o que se aceita.",
    };
  }
  if (isGeneratedId(delta)) {
    return {
      label: "NOISE",
      note:
        "id gerado por render (token aleatório antes de `-dialog-title` e afins, no id e no aria-labelledby): " +
        "muda a cada carga da mesma build; o sufixo, que é o que identifica, não muda.",
    };
  }
  if (pr.tipo === "PISO") {
    return {
      label: "NOISE",
      note: "piso: mesma base capturada duas vezes — o que difere é ruído por construção",
    };
  }
  if (isOwnBuild(delta)) {
    return {
      label: "INTENDED_CHANGE",
      note: "outra build da própria aplicação: hash de conteúdo nos assets e no HTML que os referencia",
    };
  }
  if (
    (delta.layer === "DOM" || delta.layer === "VISUAL") &&
    pr.visivel.includes(delta.observationId)
  ) {
    return {
      label: "INTENDED_CHANGE",
      note: `observação em que o PR #${numero} é visível (${pr.titulo})`,
    };
  }
  return {
    label: "NOISE",
    note:
      "sem assinatura: o PR não toca a UI desta observação, logo o delta não pode ser dele — " +
      "é a aplicação não sendo determinística, ou o motor. Fechamento para baixo.",
  };
}
