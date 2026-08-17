#!/usr/bin/env node
/**
 * Rotulagem do par de MUDANÇA INTENCIONAL do `oscar` — atribui cada delta a
 * uma das quatro mudanças legítimas de `intentional.mjs`, e decide, para cada
 * uma, se ela é `INTENDED_CHANGE` ou `NOISE`.
 *
 *   node label-intentional.mjs <report.json> <labels.json>
 *
 * POR QUE ESTE PAR PRECISA DE ROTULAGEM, SE NÃO TEM DEFEITO. Por construção,
 * nenhum delta aqui é regressão — a rotulagem não muda o número de falso
 * positivo. O que ela decide é OUTRA coisa: qual dos deltas legítimos é
 * **mudança pretendida uma vez** (`INTENDED_CHANGE`) e qual é **padrão que vai
 * se repetir e que ninguém quer ver de novo** (`NOISE`). Só o segundo alimenta
 * a supressão aprendida (RN-ORC-010). A distinção é a que um humano faria na
 * triagem, e está declarada mudança por mudança, para ser contestável.
 *
 * A DECISÃO QUE PESA. `M1` (menu de navegação passa a listar só o primeiro
 * nível) é rotulada `NOISE`, e o motivo é do django-oscar, não do motor: o menu
 * "Browse store" é gerado da árvore de categorias do banco (`category_tree`).
 * Itens entram e saem dele conforme o catálogo — categoria criada, apagada,
 * reorganizada. Um link sumindo desse menu é manutenção de dados nesta
 * aplicação, não sinal de código quebrado. **O que se aceita deixar de ver ao
 * suprimir isso está escrito na `note`**: um bug que apague o segundo nível do
 * menu produziria a mesma evidência e passaria. É exatamente essa troca que a
 * revisão humana da regra `PROPOSED` deve ler antes de ativar.
 *
 * `M2`, `M3` e `M4` são `INTENDED_CHANGE`: identidade num campo, classe numa
 * imagem, regra nova de disponibilidade. Aconteceram uma vez, de propósito, e
 * não descrevem nada que vá se repetir. Rotulá-las `NOISE` ensinaria o motor a
 * ignorar mudança de atributo em formulário e em imagem — que é justamente a
 * família das três regras de consequência da §10.11.
 *
 * FECHAMENTO PARA BAIXO, como nos outros rotuladores: delta que não casa com
 * nenhuma das quatro mudanças é `NOISE` do motor. Aqui isso é benigno para a
 * medição (não há regressão para perder) e útil para o aprendizado (é ruído
 * real de motor numa aplicação real).
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CHANGES } from "./intentional.mjs";

const [reportPath, outPath] = process.argv.slice(2);
if (reportPath === undefined || outPath === undefined) {
  process.stderr.write("uso: node label-intentional.mjs <report.json> <labels.json>\n");
  process.exit(2);
}

const report = JSON.parse(await readFile(resolve(reportPath), "utf8"));

const NAV = "div#navbarSupportedContent > ul > li[";

/** Assinaturas de cada mudança. A primeira que casar decide. */
const ASSINATURAS = [
  {
    change: "M1-menu-so-nivel-1",
    label: "NOISE",
    note:
      "menu 'Browse store' é gerado da árvore de categorias; itens entram e saem com o catálogo — " +
      "rotina nesta aplicação. AO SUPRIMIR, um bug que apague um nível do menu passa despercebido.",
    casa: (d) =>
      d.layer === "DOM" &&
      d.path.includes(NAV) &&
      ((d.kind === "DOM_NODE_REMOVED" && d.facts?.tag === "a") ||
        (d.kind === "DOM_ACCESSIBLE_NAME_CHANGED" && d.facts?.tag === "li")),
  },
  {
    change: "M2-id-no-campo-de-busca",
    label: "INTENDED_CHANGE",
    note: "campo de busca ganha id='id_q' — acréscimo de identidade, feito uma vez",
    casa: (d) =>
      d.kind === "DOM_ATTRIBUTE_ADDED" && d.facts?.attribute === "id" && d.after === "id_q",
  },
  {
    change: "M3-imagem-responsiva-na-galeria",
    label: "INTENDED_CHANGE",
    note: "imagem da galeria ganha img-fluid — mudança de classe, feita uma vez",
    casa: (d) =>
      d.kind === "DOM_ATTRIBUTE_ADDED" &&
      d.facts?.attribute === "class" &&
      d.facts?.tag === "img" &&
      /\bimg-fluid\b/.test(String(d.after ?? "")),
  },
  {
    change: "M4-sem-preco-nao-compra",
    label: "INTENDED_CHANGE",
    note: "produto sem preço passa a mostrar 'Unavailable' — regra nova de disponibilidade",
    casa: (d) =>
      d.layer === "DOM" &&
      /> article > div\[1\]/.test(d.path) &&
      /Unavailable/.test(`${d.path} ${String(d.before ?? "")} ${String(d.after ?? "")}`),
  },
];

/** Mudanças com efeito de pixel comprovado: M4 põe um ícone onde havia texto. */
const COM_PIXEL = new Set(["M4-sem-preco-nao-compra", "M3-imagem-responsiva-na-galeria"]);

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
        "Gerado por packages/diff-engine/__corpus__/oscar/label-intentional.mjs a partir das " +
        "mudanças legítimas de intentional.mjs. Não consulta o veredito do motor. Nenhum delta " +
        "é REGRESSION por construção; o que se decide aqui é INTENDED_CHANGE versus NOISE.",
      labels,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

process.stdout.write(
  `\n  ${report.deltas.length} delta(s) rotulado(s) — ${ruido} como ruído de motor\n\n` +
    CHANGES.map((change) => {
      const assinatura = ASSINATURAS.find((entry) => entry.change === change.id);
      return `    ${(porMudanca[change.id] ?? 0).toString().padStart(4)}  ${(assinatura?.label ?? "?").padEnd(15)}  ${change.id}`;
    }).join("\n") +
    "\n\n",
);

function atribuir(delta) {
  for (const assinatura of ASSINATURAS) {
    if (assinatura.casa(delta)) return assinatura;
  }
  if (delta.layer === "VISUAL") return atribuirVisual(delta);
  return null;
}

/** Pixel só é atribuído quando a MESMA observação tem mudança com efeito visual. */
function atribuirVisual(delta) {
  for (const outro of report.deltas) {
    if (outro.observationId !== delta.observationId || outro.layer === "VISUAL") continue;
    for (const assinatura of ASSINATURAS) {
      if (assinatura.casa(outro) && COM_PIXEL.has(assinatura.change)) return assinatura;
    }
  }
  return null;
}

function motivoDoRuido(delta) {
  if (delta.kind === "RESPONSE_FIELD_CHANGED") {
    return "corpo de resposta elidido no relatório: não dá para confirmar qual mudança o alterou";
  }
  if (delta.layer === "VISUAL") {
    return "pixel diferente sem mudança de efeito visual comprovado na mesma observação";
  }
  return "não atribuível a nenhuma das quatro mudanças";
}
