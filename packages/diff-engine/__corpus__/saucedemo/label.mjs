#!/usr/bin/env node
/**
 * Rotulagem do corpus `saucedemo` — atribui cada delta ao defeito do usuário
 * da captura head, ou a `NOISE`.
 *
 *   node label.mjs <report.json> <labels.json>
 *
 * O usuário vem de `report.head.label` (a captura é rotulada com o nome do
 * usuário); a lista de defeitos, de `faults.mjs`. Como nos outros corpora, a
 * rotulagem NÃO lê `classification`/`severity`/`score`: olha o que mudou e
 * confronta com o comportamento documentado do usuário. Delta que não casa
 * assinatura é NOISE — fechamento para baixo, todo erro pesa contra o motor.
 *
 * DUAS COISAS QUE ESTE CORPUS TEM E OS OUTROS NÃO:
 *
 *  - Jornada com ações e INTERRUPÇÃO. `locked_out_user` para no login;
 *    `problem_user` para no Finish. As observações que não existem no head
 *    aparecem como OBSERVATION_REMOVED e são atribuídas ao defeito que
 *    interrompeu — é a detecção pela ausência (§2.1 da medição da Fase 1).
 *  - Erros de console CAUSADOS pelo defeito: o app tem um rastreador de erros
 *    (backtrace) que só dispara quando algo quebra; a mensagem que aparece é o
 *    CORS do POST de telemetria. Não é ruído de terceiro — é o sintoma. Por
 *    isso os erros de console são atribuídos ao defeito da observação em que
 *    aparecem, e a regra "console de terceiro é MEDIUM" NÃO entrou no motor.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { FAULTS_BY_USER } from "./faults.mjs";

const [reportPath, outPath] = process.argv.slice(2);
if (reportPath === undefined || outPath === undefined) {
  process.stderr.write("uso: node label.mjs <report.json> <labels.json>\n");
  process.exit(2);
}

const report = JSON.parse(await readFile(resolve(reportPath), "utf8"));
const user = report.head.label;
const faults = FAULTS_BY_USER[user];
if (faults === undefined) {
  process.stderr.write(
    `  head.label "${user}" não é usuário do corpus (${Object.keys(FAULTS_BY_USER).join(", ")})\n`,
  );
  process.exit(2);
}

const attr = (d) =>
  d.kind === "DOM_ATTRIBUTE_CHANGED" ||
  d.kind === "DOM_ATTRIBUTE_ADDED" ||
  d.kind === "DOM_ATTRIBUTE_REMOVED"
    ? (d.facts?.attribute ?? null)
    : null;
const s = (v) => String(v ?? "");
const onList = (d) =>
  d.observationId === "inventory-sorted" || d.observationId === "inventory-added";
const isImage404 = (d) =>
  (attr(d) === "src" && /sl-404/.test(s(d.after))) ||
  (d.layer === "NETWORK" &&
    /\/assets\/.*\.(jpg|png)/.test(d.path) &&
    (d.kind === "REQUEST_REMOVED" || d.kind === "REQUEST_ADDED"));

/** Assinaturas por usuário; a primeira que casar decide. */
const ASSINATURAS = {
  locked_out_user: [
    {
      defect: "L1-login-bloqueado",
      casa: (d) => d.observationId !== "login" && d.layer !== "VISUAL",
    },
  ],
  problem_user: [
    {
      defect: "P1-link-about-404",
      casa: (d) => attr(d) === "href" && /\/error\/404/.test(s(d.after)),
    },
    { defect: "P3-imagens-404", casa: (d) => isImage404(d) },
    {
      defect: "P2-sobrenome-ignorado",
      casa: (d) =>
        (d.observationId === "checkout-overview" && d.layer !== "VISUAL") ||
        (d.kind === "OBSERVATION_REMOVED" && d.observationId === "complete"),
    },
    { defect: "P4-ordenacao-ignorada", casa: (d) => onList(d) && d.layer === "DOM" },
  ],
  error_user: [
    {
      defect: "E1-finish-nao-conclui",
      casa: (d) => d.observationId === "complete" && d.layer !== "VISUAL",
    },
    {
      defect: "E2-ordenacao-quebrada",
      casa: (d) => onList(d) && (d.layer === "DOM" || d.layer === "CONSOLE"),
    },
    {
      defect: "E3-erro-no-checkout",
      casa: (d) => d.observationId === "checkout-overview" && d.layer === "CONSOLE",
    },
  ],
  visual_user: [
    { defect: "V3-imagem-404", casa: (d) => isImage404(d) },
    {
      defect: "V2-precos-aleatorios",
      casa: (d) => d.kind === "DOM_TEXT_CHANGED" && /inventory-item-price/.test(d.path),
    },
    {
      defect: "V1-layout-desalinhado",
      casa: (d) => attr(d) === "class" && /visual_failure|align_right|misalign/.test(s(d.after)),
    },
  ],
};

const assinaturas = ASSINATURAS[user];
const comPixel = new Set(faults.filter((f) => f.pixel).map((f) => f.id));

const labels = {};
const porDefeito = {};
let ruido = 0;

for (const delta of report.deltas) {
  const defect = atribuir(delta);
  if (defect === null) {
    labels[delta.deltaId] = { label: "NOISE", note: motivoDoRuido(delta) };
    ruido += 1;
    continue;
  }
  labels[delta.deltaId] = {
    label: "REGRESSION",
    defect,
    note: faults.find((f) => f.id === defect)?.descricao ?? defect,
  };
  porDefeito[defect] = (porDefeito[defect] ?? 0) + 1;
}

await writeFile(
  resolve(outPath),
  `${JSON.stringify(
    {
      _origem: `Gerado por packages/diff-engine/__corpus__/saucedemo/label.mjs para o usuário ${user}, a partir dos comportamentos documentados em faults.mjs. Não consulta o veredito do motor.`,
      labels,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const naoVistos = faults.filter((f) => porDefeito[f.id] === undefined).map((f) => f.id);
process.stdout.write(
  `\n  ${user}: ${report.deltas.length} delta(s) rotulado(s) — ${ruido} como ruído\n\n` +
    faults
      .map((f) => `    ${(porDefeito[f.id] ?? 0).toString().padStart(4)}  D  ${f.id}`)
      .join("\n") +
    (naoVistos.length > 0
      ? `\n\n  defeitos sem NENHUM delta — invisíveis ao motor: ${naoVistos.join(", ")}\n`
      : "\n") +
    "\n",
);

function atribuir(delta) {
  for (const a of assinaturas) if (a.casa(delta)) return a.defect;
  if (delta.layer === "VISUAL") return atribuirVisual(delta);
  return null;
}

/** Pixel só é atribuído quando a MESMA observação tem defeito com efeito visual. */
function atribuirVisual(delta) {
  for (const outro of report.deltas) {
    if (outro.observationId !== delta.observationId || outro.layer === "VISUAL") continue;
    for (const a of assinaturas) if (a.casa(outro) && comPixel.has(a.defect)) return a.defect;
  }
  return null;
}

function motivoDoRuido(delta) {
  if (delta.layer === "VISUAL")
    return "pixel diferente sem defeito de efeito visual comprovado na mesma observação";
  if (delta.kind === "RESPONSE_FIELD_CHANGED")
    return "corpo de resposta elidido: não dá para confirmar marca de defeito";
  return "não atribuível a nenhum defeito documentado deste usuário";
}
