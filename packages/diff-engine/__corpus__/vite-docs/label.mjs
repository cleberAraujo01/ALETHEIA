#!/usr/bin/env node
/**
 * Rotulagem do corpus `vite-docs` — um rotulador para os quatro PRs.
 *
 *   node label.mjs <report.json> <labels.json>
 *
 * O PR vem de `report.head.label` (`pr-<n>`); a natureza dele, de `prs.mjs`.
 * Como nos outros corpora, a rotulagem NÃO lê `classification`/`severity`/
 * `score`: olha o que mudou e confronta com o que se sabe do PR.
 *
 * PR de MUDANÇA LEGÍTIMA (23230, 23237, 23092): nenhum delta é regressão por
 * construção. O rótulo decide INTENDED_CHANGE versus NOISE — o que alimenta a
 * supressão aprendida (RN-ORC-011):
 *
 *  - anúncio rotativo (`#carbonads` e os pings de DoubleClick/Google/adsrvr…):
 *    NOISE. Muda a cada carga da MESMA build (é o piso), vai se repetir em
 *    todo PR, ninguém quer ver de novo. É o candidato certo a regra aprendida,
 *    com evidência de execuções distintas de verdade;
 *  - a barra de ferramentas que o Netlify injeta no preview (`app.netlify.com`,
 *    `cdn.segment.com`, `bugsnag`) e o aviso de driver GL do Chromium: NOISE
 *    de ambiente, não da aplicação;
 *  - conteúdo (`main`, cabeçalho, barra lateral): INTENDED_CHANGE — do PR,
 *    quando a página é a do arquivo `.md` que ele toca; senão, drift entre a
 *    `main` que a produção mostra e a base do PR. A nota diz qual;
 *  - rede da própria aplicação (chunks, JSON de busca): INTENDED_CHANGE, outra
 *    build;
 *  - pixel: INTENDED_CHANGE se a mesma observação tem conteúdo mudado; senão
 *    NOISE (o anúncio também muda pixel).
 *
 * PR COM DEFEITO (23201): as assinaturas de `V1` são as três faces do mesmo
 * componente que não renderiza — nós do cabeçalho de tradução, os dois erros
 * de console, a requisição de ícones sem `languages`. O resto do par é como um
 * PR legítimo (drift do vitepress: "Copy Code" → "Copy code"), rotulado com as
 * mesmas regras acima. Fechamento para baixo: só casa V1 o que a descrição do
 * defeito prevê.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PRS, routeOfDocFile } from "./prs.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const [reportPath, outPath] = process.argv.slice(2);
if (reportPath === undefined || outPath === undefined) {
  process.stderr.write("uso: node label.mjs <report.json> <labels.json>\n");
  process.exit(2);
}

const report = JSON.parse(await readFile(resolve(reportPath), "utf8"));
const journey = JSON.parse(await readFile(resolve(HERE, "journey.json"), "utf8"));
// O piso (produção × produção de novo) também é rotulado: é a fonte mais pura
// de NOISE que existe — mesma build, nada é mudança por construção — e é
// evidência de execução distinta para a supressão aprendida.
const PISO = { tipo: "PISO", titulo: "mesma produção, duas capturas", arquivos: [] };
const numero = /^pr-(\d+)$/.exec(report.head.label ?? "")?.[1];
const pr =
  report.head.label === "base-rerun" ? PISO : numero === undefined ? undefined : PRS[numero];
if (pr === undefined) {
  process.stderr.write(
    `  head.label "${report.head.label}" não é PR do corpus (${Object.keys(PRS).join(", ")}) nem base-rerun\n`,
  );
  process.exit(2);
}

const arquivoDaPagina = (obs) => {
  const rota = journey.observations.find((o) => o.observationId === obs)?.path;
  return pr.arquivos.find((f) => routeOfDocFile(f) === rota) ?? null;
};

const s = (v) => String(v ?? "");
const AD_HOSTS =
  /carbonads\.net|doubleclick\.net|google\.com\/gmp|adsrvr\.org|rubiconproject\.com|casalemedia\.com|carbonads\.com/;
const PREVIEW_TOOLBAR = /app\.netlify\.com|cdn\.segment\.com|bugsnag\.com/;
const isAd = (d) =>
  (d.layer === "DOM" && /#carbonads/.test(d.path)) ||
  (d.layer === "NETWORK" && AD_HOSTS.test(d.path));
const isPreviewToolbar = (d) => d.layer === "NETWORK" && PREVIEW_TOOLBAR.test(d.path);
const isGlDriverNoise = (d) =>
  d.layer === "CONSOLE" && /GL Driver Message/.test(s(d.after ?? d.before));

/** Assinaturas do defeito V1 do #23201 — cada uma é uma face do componente que não renderiza. */
const V1 = "V1-menu-de-idiomas-nao-renderiza";
const ASSINATURAS_DEFEITO = [
  {
    defect: V1,
    casa: (d) =>
      d.layer === "DOM" &&
      / header > /.test(d.path) &&
      (d.kind === "DOM_NODE_REMOVED" ||
        d.kind === "DOM_NODE_ADDED" ||
        d.kind === "DOM_CHILDREN_REORDERED" ||
        d.kind === "DOM_ATTRIBUTE_CHANGED"),
  },
  {
    defect: V1,
    casa: (d) =>
      d.layer === "CONSOLE" &&
      d.kind === "CONSOLE_MESSAGE_ADDED" &&
      /Hydration completed but contains mismatches|Cannot read properties of undefined \(reading 'value'\)/.test(
        s(d.after),
      ),
  },
  {
    defect: V1,
    casa: (d) => d.layer === "NETWORK" && /api\.iconify\.design/.test(d.path),
  },
];
const defeitos = pr.tipo === "DEFEITO" ? pr.defeitos : [];
const comPixel = new Set(defeitos.filter((f) => f.pixel).map((f) => f.id));

const labels = {};
const porDefeito = {};
const contagem = { REGRESSION: 0, INTENDED_CHANGE: 0, NOISE: 0 };

for (const delta of report.deltas) {
  const defect = pr.tipo === "DEFEITO" ? atribuir(delta) : null;
  if (defect !== null) {
    labels[delta.deltaId] = {
      label: "REGRESSION",
      defect,
      note: defeitos.find((f) => f.id === defect)?.descricao ?? defect,
    };
    porDefeito[defect] = (porDefeito[defect] ?? 0) + 1;
    contagem.REGRESSION += 1;
    continue;
  }
  const { label, note } = rotularLegitimo(delta);
  labels[delta.deltaId] = { label, note };
  contagem[label] += 1;
}

await writeFile(
  resolve(outPath),
  `${JSON.stringify(
    {
      _origem: `Gerado por packages/diff-engine/__corpus__/vite-docs/label.mjs para ${pr.tipo === "PISO" ? "o piso (base × base-rerun)" : `o PR #${numero} (${pr.tipo})`}, a partir de prs.mjs. Não consulta o veredito do motor.`,
      labels,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const naoVistos = defeitos.filter((f) => porDefeito[f.id] === undefined).map((f) => f.id);
process.stdout.write(
  `\n  ${pr.tipo === "PISO" ? "piso" : `PR #${numero}`} (${pr.tipo}): ${report.deltas.length} delta(s) — ` +
    `${contagem.REGRESSION} regressão, ${contagem.INTENDED_CHANGE} mudança pretendida, ${contagem.NOISE} ruído\n` +
    (defeitos.length > 0
      ? `\n${defeitos.map((f) => `    ${(porDefeito[f.id] ?? 0).toString().padStart(4)}  D  ${f.id}`).join("\n")}\n`
      : "") +
    (naoVistos.length > 0
      ? `\n  defeitos sem NENHUM delta — invisíveis ao motor: ${naoVistos.join(", ")}\n`
      : "") +
    "\n",
);

function atribuir(delta) {
  for (const a of ASSINATURAS_DEFEITO) if (a.casa(delta)) return a.defect;
  if (delta.layer === "VISUAL") return atribuirVisual(delta);
  return null;
}

/** Pixel só é atribuído quando a MESMA observação tem defeito com efeito visual. */
function atribuirVisual(delta) {
  for (const outro of report.deltas) {
    if (outro.observationId !== delta.observationId || outro.layer === "VISUAL") continue;
    for (const a of ASSINATURAS_DEFEITO)
      if (a.casa(outro) && comPixel.has(a.defect)) return a.defect;
  }
  return null;
}

function rotularLegitimo(delta) {
  if (pr.tipo === "PISO" && !isAd(delta)) {
    return {
      label: "NOISE",
      note: "piso: mesma produção capturada duas vezes — o que difere é ruído por construção",
    };
  }
  if (isAd(delta)) {
    return {
      label: "NOISE",
      note:
        "anúncio rotativo de terceiro (#carbonads e seus pings): muda a cada carga da mesma build. " +
        "AO SUPRIMIR, um bug que quebre o slot do anúncio passa despercebido — e é o que se aceita.",
    };
  }
  if (isPreviewToolbar(delta)) {
    return {
      label: "NOISE",
      note: "barra de ferramentas que o Netlify injeta no deploy preview; não é a aplicação",
    };
  }
  if (isGlDriverNoise(delta)) {
    return {
      label: "NOISE",
      note: "aviso de driver GL do Chromium headless; ambiente, não aplicação",
    };
  }
  if (delta.layer === "DOM") {
    const arquivo = arquivoDaPagina(delta.observationId);
    return arquivo !== null
      ? { label: "INTENDED_CHANGE", note: `página do arquivo que o PR toca (${arquivo})` }
      : {
          label: "INTENDED_CHANGE",
          note: "drift: a produção mostra a main de hoje; o preview, a base do PR mais o PR",
        };
  }
  if (delta.layer === "NETWORK") {
    return {
      label: "INTENDED_CHANGE",
      note: "outra build da própria aplicação: chunks, índice de busca, dados de página",
    };
  }
  if (delta.layer === "CONSOLE") {
    return {
      label: "INTENDED_CHANGE",
      note: "console de outra build; não casa nenhum sinal conhecido de ruído",
    };
  }
  // VISUAL
  const temConteudo = report.deltas.some(
    (o) => o.observationId === delta.observationId && o.layer === "DOM" && !isAd(o),
  );
  return temConteudo
    ? { label: "INTENDED_CHANGE", note: "pixel de página cujo conteúdo mudou (PR ou drift)" }
    : { label: "NOISE", note: "pixel diferente sem conteúdo mudado na observação: é o anúncio" };
}
