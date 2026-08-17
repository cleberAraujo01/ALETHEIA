#!/usr/bin/env node
/**
 * Rotulagem do SEGUNDO PR REAL do `juventude` — `910181f`, "Aprimora pagina de
 * parceiros, adiciona BMW Agency e remove /apoie" (2026-08-04), o par medido na
 * §10.9 de `docs/medicao-fase-0.md`.
 *
 *   node label-pr2.mjs <report.json> <labels.json>
 *
 * Nenhum delta aqui é regressão: é um PR legítimo, sem defeito. O que este
 * rotulador decide é o mesmo que `oscar/label-intentional.mjs`: o que é
 * mudança pretendida UMA VEZ (`INTENDED_CHANGE`) e o que é padrão que vai se
 * repetir (`NOISE`) — só o segundo alimenta a supressão aprendida.
 *
 * A DECISÃO QUE PESA, E ELA VAI NA DIREÇÃO OPOSTA À DO OSCAR. Os 11 deltas
 * bloqueantes deste par (7 vezes o `<li>` "Apoie o clube" saindo do rodapé, 3
 * do redesenho de /parceiros, 1 `href` reapontado de /apoie para /parceiros)
 * são todos `INTENDED_CHANGE`, não `NOISE`. O rodapé do juventude é escrito à
 * mão no código; um link que some dele é decisão de produto — desta vez — e
 * pode ser bug na próxima. `F6-rota-quem-somos`, do corpus de defeitos, é
 * exatamente um link do mesmo rodapé apontando errado. Rotular a remoção como
 * "rotina" ensinaria o motor a não olhar para o lugar onde um dos nove
 * defeitos reais mora.
 *
 * Consequência honesta: este PR não gera NENHUMA regra de supressão. Os 11
 * bloqueantes continuam sendo falso positivo, e a única resposta para eles é a
 * que a §10.9 já deu — intenção derivada do diff de código (O2), fora desta
 * fase.
 *
 * O ruído de rede (`_next/static/...` com hash, corpo RSC com `_rsc=`) é
 * `NOISE` de motor: artefato de build e identidade de sessão. É achado de
 * NORMALIZAÇÃO, e o aprendizado de supressão o ignora de propósito.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [reportPath, outPath] = process.argv.slice(2);
if (reportPath === undefined || outPath === undefined) {
  process.stderr.write("uso: node label-pr2.mjs <report.json> <labels.json>\n");
  process.exit(2);
}

const report = JSON.parse(await readFile(resolve(reportPath), "utf8"));

const ASSINATURAS = [
  {
    change: "P1-remove-rota-apoie",
    label: "INTENDED_CHANGE",
    note:
      "rota /apoie removida de propósito: o item sai do rodapé e o CTA da home passa a apontar " +
      "para /parceiros — evento único, não padrão",
    casa: (d) =>
      d.layer === "DOM" &&
      ((d.kind === "DOM_NODE_REMOVED" &&
        d.path.includes('nav[role=navigation "Rodapé"]') &&
        d.path.includes('"Apoie o clube"')) ||
        (d.kind === "DOM_ATTRIBUTE_CHANGED" &&
          d.facts?.attribute === "href" &&
          String(d.before ?? "") === "/apoie")),
  },
  {
    change: "P2-redesenho-parceiros",
    label: "INTENDED_CHANGE",
    note: "página /parceiros redesenhada: lista de etapas, CTA e cards reorganizados",
    casa: (d) =>
      d.layer === "DOM" && d.observationId === "parceiros" && d.path.includes("main#conteudo"),
  },
  {
    change: "P3-adiciona-bmw-agency",
    label: "INTENDED_CHANGE",
    note: "novo apoiador na seção de patrocinadores da home, com ajuste de classe no logo vizinho",
    casa: (d) =>
      d.layer === "DOM" &&
      d.observationId === "home" &&
      d.path.includes('section[role=region "Patrocinadores e apoiadores"]'),
  },
];

const labels = {};
const porMudanca = {};
let ruido = 0;

for (const delta of report.deltas) {
  const hit = atribuir(delta);
  if (hit === null) {
    labels[delta.deltaId] = { label: "NOISE", note: motivoDoRuido(delta) };
    ruido += 1;
    continue;
  }
  labels[delta.deltaId] = { label: hit.label, note: `${hit.change}: ${hit.note}` };
  porMudanca[hit.change] = (porMudanca[hit.change] ?? 0) + 1;
}

await writeFile(
  resolve(outPath),
  `${JSON.stringify(
    {
      _origem:
        "Gerado por packages/diff-engine/__corpus__/juventude/label-pr2.mjs a partir do conteúdo " +
        "do PR 910181f. Não consulta o veredito do motor. Nenhum delta é REGRESSION por " +
        "construção; o que se decide aqui é INTENDED_CHANGE versus NOISE.",
      labels,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

process.stdout.write(
  `\n  ${report.deltas.length} delta(s) rotulado(s) — ${ruido} como ruído de motor\n\n` +
    ASSINATURAS.map(
      (a) =>
        `    ${(porMudanca[a.change] ?? 0).toString().padStart(4)}  ${a.label.padEnd(15)}  ${a.change}`,
    ).join("\n") +
    "\n\n",
);

function atribuir(delta) {
  for (const assinatura of ASSINATURAS) {
    if (assinatura.casa(delta)) return assinatura;
  }
  if (delta.layer === "VISUAL") return atribuirVisual(delta);
  return null;
}

/**
 * Pixel é atribuído quando a MESMA observação tem mudança de DOM pretendida —
 * o rodapé perde uma linha em toda página, então toda página muda de altura.
 */
function atribuirVisual(delta) {
  for (const outro of report.deltas) {
    if (outro.observationId !== delta.observationId || outro.layer !== "DOM") continue;
    for (const assinatura of ASSINATURAS) if (assinatura.casa(outro)) return assinatura;
  }
  return null;
}

function motivoDoRuido(delta) {
  if (/\/_next\/static\//.test(delta.path)) {
    return "artefato de build: hash de bundle muda a cada build — achado de normalização, não de supressão";
  }
  if (delta.kind === "RESPONSE_FIELD_CHANGED") {
    return "corpo de resposta elidido no relatório: não dá para confirmar qual mudança o alterou";
  }
  if (delta.layer === "VISUAL") {
    return "pixel diferente sem mudança de DOM pretendida na mesma observação";
  }
  return "não atribuível ao conteúdo do PR";
}
