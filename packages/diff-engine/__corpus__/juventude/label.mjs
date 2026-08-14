#!/usr/bin/env node
/**
 * Rotulagem do corpus `juventude` — atribui cada delta do relatório a um dos
 * defeitos declarados em `faults.mjs`, ou a `NOISE`.
 *
 *   node label.mjs <report.json> <labels.json>
 *
 * POR QUE ISTO NÃO É "O MOTOR SE AUTOAVALIANDO". A rotulagem não olha o que o
 * motor decidiu — não lê `classification`, `severity` nem `score`. Ela olha o
 * que MUDOU (caminho, tipo, antes, depois) e confronta com a verdade que existe
 * independentemente do motor: as nove alterações de código-fonte que nós
 * mesmos aplicamos. É a mesma coisa que um humano faria com o diff do PR na
 * mão, só que sem cansar na página 200 e sem mudar de critério no meio.
 *
 * A REGRA DE OURO É O FECHAMENTO PARA BAIXO: delta que não casa com nenhuma
 * assinatura de defeito é `NOISE`, sempre. Nunca o contrário. Isso empurra
 * todo erro da rotulagem contra o motor — um delta legítimo que a regra não
 * reconheça vira falso positivo dele, não acerto. Um rotulador que, na dúvida,
 * desse o benefício ao motor produziria exatamente o número que se quer ouvir.
 *
 * As duas builds são idênticas exceto pelos nove defeitos e pelo que o próprio
 * processo de build gera de diferente (identificador de build, hash de bundle).
 * Logo, todo delta ou vem de um defeito, ou vem do build — não há terceira
 * origem possível, e é isso que torna esta rotulagem verificável.
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

const ROTA_POR_OBSERVACAO = {
  home: "/",
  escolinha: "/escolinha",
  time: "/time",
  "quem-somos": "/quem-somos",
  canais: "/canais",
  contato: "/contato",
  parceiros: "/parceiros",
};

/** Rotas onde o banner das internas existe (a home tem hero próprio). */
const ROTAS_COM_BANNER = ["/time", "/quem-somos", "/canais", "/contato", "/parceiros"];

/**
 * Defeitos que produzem saída no console, e o que cada um emite.
 *
 * A MENSAGEM SOZINHA NÃO IDENTIFICA O DEFEITO: o texto é "Failed to load
 * resource: the server responded with a status of 404 (Not Found)", sem a URL.
 * Atribuir por ele seria inferência, não evidência — e a rotulagem fecha para
 * baixo por princípio.
 *
 * Por isso vale a mesma ponte usada para pixel: o delta de console só é
 * atribuído quando OUTRA camada, na MESMA observação, já carrega a assinatura
 * daquele defeito. No corpus isso significa que o 404 de console só conta para
 * F6 nas páginas onde o link /quemsomos aparece no DOM ou na rede.
 */
const DEFEITOS_COM_CONSOLE = new Set([
  // Rota com erro de digitação: o prefetch recebe 404 e o browser registra.
  "F6-rota-quem-somos",
  // O mapa do Google carrega junto com a página e loga por conta própria.
  "F4-mapa-eager",
]);

/** Defeitos que necessariamente mudam pixels na tela. */
const DEFEITOS_COM_PIXEL = new Set([
  "F1-splash-global",
  "F2-contraste-aa",
  "F3-ticker-contraste",
  "F4-mapa-eager",
  "F5-banner-css",
  "F9-turmas-off-by-one",
]);

/**
 * Assinaturas de cada defeito. A primeira que casar decide — a ordem importa
 * só quando um delta carrega marca de dois defeitos (o caso dos payloads de
 * documento, que contêm o HTML inteiro); ali qualquer atribuição entre os
 * defeitos presentes é correta para a contagem, porque ambos são reais.
 */
const ASSINATURAS = [
  {
    defect: "F6-rota-quem-somos",
    casa: (d) =>
      texto(d).includes("/quemsomos") ||
      (d.kind === "REQUEST_REMOVED" && d.path.includes("/quem-somos?_rsc")),
  },
  {
    defect: "F4-mapa-eager",
    casa: (d) =>
      /maps\.googleapis\.com|maps\.gstatic\.com|google\.com\/maps/.test(d.path) ||
      (d.observationId === "contato" &&
        texto(d).includes("O mapa do Google carrega aqui quando você quiser")),
  },
  {
    defect: "F9-turmas-off-by-one",
    casa: (d) =>
      d.observationId === "escolinha" &&
      (texto(d).includes("Sub-16") || (d.kind === "DOM_TEXT_CHANGED" && d.before === "05")),
  },
  {
    defect: "F7-email-sem-required",
    casa: (d) => d.kind === "DOM_ATTRIBUTE_REMOVED" && d.facts?.attribute === "required",
  },
  {
    defect: "F8-whatsapp-digito",
    casa: (d) => texto(d).includes("5511941126939") || texto(d).includes("5511941126936"),
  },
  {
    defect: "F5-banner-css",
    casa: (d) =>
      ROTAS_COM_BANNER.includes(rota(d)) &&
      (texto(d).includes("background-image:url(/banner-paginas") ||
        texto(d).includes("bg-cover") ||
        d.path.includes("/banner-paginas.webp") ||
        d.path.includes("/_next/image") ||
        // Cascata de realinhamento: com o <img> fora, os irmãos da seção do
        // banner mudam de índice e o alinhamento posicional os reporta. É
        // consequência direta do mesmo defeito.
        /^body > main#conteudo > (div\[\d+\] > )?section(\[0\])? > (img|div\[\d+\]|div\b)/.test(
          d.path,
        )),
  },
  {
    defect: "F3-ticker-contraste",
    casa: (d) =>
      d.path.includes('aside[role=complementary "Próximo jogo do time"]') &&
      texto(d).includes("bg-red"),
  },
  {
    defect: "F2-contraste-aa",
    casa: (d) =>
      d.kind === "DOM_ATTRIBUTE_CHANGED" &&
      d.facts?.attribute === "class" &&
      contraste(String(d.before), String(d.after)),
  },
  {
    defect: "F1-splash-global",
    // O splash já saiu do DOM quando a captura acontece (a hidratação o
    // desmonta fora da home), então o rastro observável dele é a imagem do
    // brasão que ele pede com priority nas páginas internas.
    casa: (d) =>
      texto(d).includes("splash-intro") || (rota(d) !== "/" && d.path.includes("brasao-footer")),
  },
];

/**
 * O payload de documento e de RSC carrega o HTML inteiro, então qualquer
 * defeito aparece lá dentro. Buscar a assinatura no corpo é o que separa
 * "mudou porque o defeito está lá" de "mudou só o identificador do build".
 */
const ASSINATURAS_EM_CORPO = [
  ["F6-rota-quem-somos", /\/quemsomos/],
  ["F5-banner-css", /background-image:url\(\/banner-paginas/],
  ["F8-whatsapp-digito", /5511941126939/],
  ["F9-turmas-off-by-one", /Sub-16/],
  ["F2-contraste-aa", /bg-red[^-]/],
  ["F1-splash-global", /splash-intro/],
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
        "Gerado por packages/diff-engine/__corpus__/juventude/label.mjs a partir das " +
        "alterações de código-fonte declaradas em faults.mjs. Não consulta o veredito do motor.",
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
  if (delta.kind === "RESPONSE_FIELD_CHANGED") return atribuirCorpo(delta);
  if (delta.layer === "VISUAL") return atribuirVisual(delta);
  if (delta.layer === "CONSOLE") return atribuirConsole(delta);
  return null;
}

/**
 * Um payload só conta como regressão se a diferença entre base e head contiver
 * a marca de um defeito. Se as duas versões diferem apenas no identificador de
 * build ou no nome com hash dos bundles, é ruído do processo de build.
 */
function atribuirCorpo(delta) {
  const antes = String(delta.before ?? "");
  const depois = String(delta.after ?? "");
  for (const [defect, marca] of ASSINATURAS_EM_CORPO) {
    if (marca.test(depois) !== marca.test(antes)) return defect;
  }
  return null;
}

/**
 * Delta visual só é atribuído quando a mesma observação já tem um defeito com
 * efeito de pixel comprovado por outra camada. Pixel diferente sem causa
 * identificada é ruído — atribuir por proximidade seria fabricar acerto.
 */
function atribuirVisual(delta) {
  const doMesmoAlvo = report.deltas.filter(
    (outro) => outro.observationId === delta.observationId && outro.layer !== "VISUAL",
  );
  for (const outro of doMesmoAlvo) {
    const defect = (() => {
      for (const assinatura of ASSINATURAS) if (assinatura.casa(outro)) return assinatura.defect;
      return null;
    })();
    if (defect !== null && DEFEITOS_COM_PIXEL.has(defect)) return defect;
  }
  return null;
}

/**
 * Console só é atribuído com confirmação de outra camada na mesma observação —
 * a mesma regra do pixel, pelo mesmo motivo: sem ela, qualquer mensagem que
 * aparecesse viraria acerto de graça.
 */
function atribuirConsole(delta) {
  for (const outro of report.deltas) {
    if (outro.observationId !== delta.observationId) continue;
    if (outro.layer === "VISUAL" || outro.layer === "CONSOLE") continue;
    for (const assinatura of ASSINATURAS) {
      if (assinatura.casa(outro) && DEFEITOS_COM_CONSOLE.has(assinatura.defect)) {
        return assinatura.defect;
      }
    }
  }
  return null;
}

/** Detecta a troca de contraste do F2 nas duas direções da lista de classes. */
function contraste(antes, depois) {
  const tinhaBranco = /\btext-white\b/.test(antes);
  const temPaper = /\btext-paper\b/.test(depois);
  return tinhaBranco && temPaper;
}

function texto(delta) {
  return `${delta.path} ${String(delta.before ?? "")} ${String(delta.after ?? "")}`;
}

function rota(delta) {
  return ROTA_POR_OBSERVACAO[delta.observationId] ?? "";
}

function motivoDoRuido(delta) {
  if (/\/_next\/static\/chunks\//.test(delta.path)) {
    return "hash de bundle: o mesmo módulo com outro nome porque o build mudou";
  }
  if (delta.kind === "RESPONSE_FIELD_CHANGED") {
    return "payload difere apenas por identificador de build, sem marca de defeito";
  }
  if (delta.layer === "VISUAL") {
    return "pixel diferente sem defeito identificado na mesma observação";
  }
  if (delta.layer === "CONSOLE") {
    return "mensagem de console sem defeito confirmado por outra camada na mesma observação";
  }
  return "não atribuível a nenhum dos defeitos aplicados";
}

function descricaoDoDefeito(id) {
  return FAULTS.find((fault) => fault.id === id)?.descricao ?? id;
}
