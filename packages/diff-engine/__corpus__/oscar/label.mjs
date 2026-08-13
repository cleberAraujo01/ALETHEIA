#!/usr/bin/env node
/**
 * Rotulagem do corpus `oscar` — atribui cada delta do relatório a um dos
 * defeitos declarados em `faults.mjs`, ou a `NOISE`.
 *
 *   node label.mjs <report.json> <labels.json>
 *
 * POR QUE ISTO NÃO É "O MOTOR SE AUTOAVALIANDO". A rotulagem não lê
 * `classification`, `severity` nem `score`. Ela olha o que MUDOU (caminho,
 * tipo, antes, depois) e confronta com a verdade que existe independentemente
 * do motor: as sete alterações de template que nós mesmos aplicamos.
 *
 * A REGRA DE OURO É O FECHAMENTO PARA BAIXO: delta que não casa com nenhuma
 * assinatura é `NOISE`, sempre. Todo erro da rotulagem pesa contra o motor.
 *
 * DIFERENÇA IMPORTANTE EM RELAÇÃO AO CORPUS `juventude`: lá as duas builds
 * diferiam também pelo processo de build (hash de bundle, identificador de
 * build), e boa parte do ruído vinha daí. Aqui não há build: Django lê o
 * template a cada request, e as duas builds diferem **apenas** pelos sete
 * defeitos. Todo delta ou vem de um defeito, ou é ruído do próprio motor — não
 * existe terceira origem. É um teste mais duro, e de propósito.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { FAULTS } from "./faults.mjs";

const [reportPath, outPath] = process.argv.slice(2);
if (reportPath === undefined || outPath === undefined) {
  process.stderr.write("uso: node label.mjs <report.json> <labels.json>\n");
  process.exit(2);
}

const report = JSON.parse(await readFile(resolve(reportPath), "utf8"));

/**
 * Defeitos que comprovadamente movem pixel.
 *
 * O2 e O6 são óbvios: um troca o eixo de empilhamento da lista de categorias, o
 * outro remove um produto da listagem.
 *
 * O7 (miniatura sem `alt`) NÃO é óbvio, e por isso foi MEDIDO antes de entrar
 * aqui: com o defeito aplicado sozinho, a altura da página muda exatamente nas
 * páginas que têm listagem de produto e exatamente na mesma medida do conjunto
 * completo (`/en-gb/offers/`: 10737 → 10755 px nos dois casos). A causa é que
 * imagem ainda não pintada renderiza o texto do `alt`, que ocupa espaço; sem o
 * atributo não há o que renderizar. Sem essa medição, atribuir os 132 deltas
 * visuais de `/en-gb/offers/` ao defeito seria fabricar acerto por proximidade.
 */
const DEFEITOS_COM_PIXEL = new Set([
  "O2-categorias-empilhadas",
  "O6-listagem-off-by-one",
  "O7-miniatura-sem-alt",
]);

/** Assinaturas de cada defeito. A primeira que casar decide. */
const ASSINATURAS = [
  {
    defect: "O1-paginacao-acumula-page",
    // O href da paginação passa a carregar dois `page`.
    casa: (d) => atributo(d) === "href" && /page=\d+&page=/.test(String(d.after ?? "")),
  },
  {
    defect: "O4-rota-ofertas-quebrada",
    casa: (d) => atributo(d) === "href" && String(d.after ?? "") === "/en-gb/offer/",
  },
  {
    defect: "O5-busca-action-errado",
    casa: (d) =>
      atributo(d) === "action" &&
      String(d.before ?? "") === "/en-gb/search/" &&
      String(d.after ?? "") === "/en-gb/catalogue/",
  },
  {
    defect: "O3-busca-oculta-none",
    casa: (d) => atributo(d) === "value" && String(d.after ?? "") === "None",
  },
  {
    defect: "O2-categorias-empilhadas",
    casa: (d) =>
      atributo(d) === "class" &&
      /\bflex-column\b/.test(String(d.before ?? "")) &&
      !/\bflex-column\b/.test(String(d.after ?? "")),
  },
  {
    defect: "O7-miniatura-sem-alt",
    casa: (d) =>
      (d.kind === "DOM_ATTRIBUTE_REMOVED" && atributo(d) === "alt") ||
      // O nome acessível de uma imagem vem do `alt`; perdê-lo é o mesmo defeito
      // visto pela árvore de acessibilidade, não um segundo achado.
      (d.kind === "DOM_ACCESSIBLE_NAME_CHANGED" && d.facts?.tag === "img" && d.after === null),
  },
  {
    defect: "O6-listagem-off-by-one",
    casa: (d) =>
      (d.kind === "DOM_NODE_REMOVED" && d.facts?.tag === "li") ||
      // A miniatura do produto que sumiu deixa de ser pedida. É consequência
      // direta do mesmo defeito, não achado independente.
      (d.kind === "REQUEST_REMOVED" && /\/media\/cache\//.test(d.path)),
  },
];

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
  labels[delta.deltaId] = { label: "REGRESSION", defect, note: descricaoDoDefeito(defect) };
  porDefeito[defect] = (porDefeito[defect] ?? 0) + 1;
}

await writeFile(
  resolve(outPath),
  `${JSON.stringify(
    {
      _origem:
        "Gerado por packages/diff-engine/__corpus__/oscar/label.mjs a partir das alterações " +
        "de template declaradas em faults.mjs. Não consulta o veredito do motor.",
      labels,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const naoVistos = FAULTS.filter((fault) => porDefeito[fault.id] === undefined).map((f) => f.id);

process.stdout.write(
  `\n  ${report.deltas.length} delta(s) rotulado(s) — ${ruido} como ruído\n\n` +
    FAULTS.map(
      (fault) =>
        `    ${(porDefeito[fault.id] ?? 0).toString().padStart(4)}  ${fault.origem === "HISTORICO" ? "H" : "I"}  ${fault.id}`,
    ).join("\n") +
    (naoVistos.length > 0
      ? `\n\n  defeitos sem NENHUM delta — invisíveis ao motor: ${naoVistos.join(", ")}\n`
      : "\n") +
    "\n",
);

function atribuir(delta) {
  for (const assinatura of ASSINATURAS) {
    if (assinatura.casa(delta)) return assinatura.defect;
  }
  if (delta.layer === "VISUAL") return atribuirVisual(delta);
  return null;
}

/**
 * Delta visual só é atribuído quando a MESMA observação já tem, em outra camada,
 * um defeito com efeito de pixel comprovado. Pixel diferente sem causa
 * identificada na mesma página é ruído.
 *
 * O corpo de resposta (`RESPONSE_FIELD_CHANGED`) fica de fora desta ponte de
 * propósito: o relatório o guarda elidido, então não dá para confirmar que a
 * marca do defeito está lá dentro. Sem essa confirmação, ele é ruído — os dez
 * corpos desta medição contam contra o motor.
 */
function atribuirVisual(delta) {
  for (const outro of report.deltas) {
    if (outro.observationId !== delta.observationId || outro.layer === "VISUAL") continue;
    for (const assinatura of ASSINATURAS) {
      if (assinatura.casa(outro) && DEFEITOS_COM_PIXEL.has(assinatura.defect)) {
        return assinatura.defect;
      }
    }
  }
  return null;
}

function atributo(delta) {
  return delta.kind === "DOM_ATTRIBUTE_CHANGED" || delta.kind === "DOM_ATTRIBUTE_REMOVED"
    ? (delta.facts?.attribute ?? null)
    : null;
}

function motivoDoRuido(delta) {
  if (delta.kind === "RESPONSE_FIELD_CHANGED") {
    return "corpo de resposta elidido no relatório: não dá para confirmar marca de defeito";
  }
  if (delta.layer === "VISUAL") {
    return "pixel diferente sem defeito de efeito visual comprovado na mesma observação";
  }
  return "não atribuível a nenhum dos defeitos aplicados";
}

function descricaoDoDefeito(id) {
  return FAULTS.find((fault) => fault.id === id)?.descricao ?? id;
}
