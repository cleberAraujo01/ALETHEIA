#!/usr/bin/env node
/**
 * Bancada de medição dos corpora reais — `pnpm corpora:medir`.
 *
 * O §11 do `CLAUDE.md` exige que todo PR que toca `diff-engine` cole a tabela
 * dos quatro pares, e a §11 de `docs/medicao-fase-0.md` lista os comandos que a
 * produzem. São quinze invocações de CLI, duas de rotulagem e uma conta de
 * cabeça — o suficiente para que a exigência seja cumprida com preguiça ou não
 * seja cumprida.
 *
 * Este script roda a metade que NÃO precisa de rebuild: dadas as capturas já em
 * disco, ele refaz diff, rotulagem e medição de todos os pares e imprime a
 * tabela pronta para colar. A metade cara — clonar as aplicações, aplicar os
 * defeitos, subir dois servidores, capturar — continua sendo a §11 do documento
 * de medição, e continua sendo pré-requisito.
 *
 * ELE NÃO É UM GATE, E A DISTINÇÃO IMPORTA. `pnpm corpus:gate` roda no CI, sobre
 * fixtures versionados, e REPROVA. Este aqui roda na máquina de quem está
 * calibrando, sobre capturas que ninguém versiona, e só informa. Transformá-lo
 * em gate exigiria versionar 28 MB de captura com screenshot de página inteira —
 * decisão que a §11 da medição já tomou no sentido contrário.
 *
 * PAR AUSENTE NUNCA VIRA TABELA COMPLETA. A §10.3.1 registra o custo de um
 * ambiente montado pela metade: ele não falha, ele fabrica um mecanismo
 * plausível e falso. Por isso, se qualquer par declarado não tiver captura em
 * disco, o script diz quais faltam, marca a tabela como incompleta e sai com
 * código 1. `--parcial` permite seguir mesmo assim, e a marca na tabela
 * permanece.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "shims/cli/dist/main.js");

const { assessGrouping, measure, parseSuppressionSet, simulateSuppression } = await import(
  pathToFileURL(join(ROOT, "packages/diff-engine/dist/index.js")).href
);

/**
 * Os pares, na ordem em que o `PULL_REQUEST_TEMPLATE` os cobra.
 *
 * `rotulador` de DEFEITO só existe onde há defeito aplicado; a coluna de
 * "x de y" vem dele. Os pares de mudança intencional têm rotulador também, mas
 * de outra natureza: neles nenhum delta é regressão por construção, e o rótulo
 * decide só INTENDED_CHANGE versus NOISE — o que alimenta a supressão
 * aprendida. Por isso `semDefeito: true`: a tabela principal não muda por causa
 * dele; ele existe para a simulação de supressão logo abaixo dela.
 *
 * `projeto` liga o par ao arquivo de regras aprendidas do corpus
 * (`__corpus__/<projeto>/suppressions.json`), quando existir. Pisos de
 * aplicação desconhecida não têm projeto: não há corpus deles.
 */
const PARES = [
  {
    id: "juventude-defeitos",
    titulo: "Juventude — 9 defeitos",
    projeto: "juventude",
    base: ".aletheia/fase0/base",
    head: ".aletheia/fase0/head",
    rotulador: "packages/diff-engine/__corpus__/juventude/label.mjs",
  },
  {
    id: "juventude-pr2",
    titulo: "Juventude — PR real #2 (910181f)",
    projeto: "juventude",
    base: ".aletheia/fase0/pr2-antes",
    head: ".aletheia/fase0/pr2-depois",
    rotulador: "packages/diff-engine/__corpus__/juventude/label-pr2.mjs",
    semDefeito: true,
  },
  {
    id: "oscar-defeitos",
    titulo: "Oscar — 7 defeitos",
    projeto: "oscar",
    base: ".aletheia/oscar/base",
    head: ".aletheia/oscar/head",
    rotulador: "packages/diff-engine/__corpus__/oscar/label.mjs",
  },
  {
    id: "oscar-intencional",
    titulo: "Oscar — mudança intencional",
    projeto: "oscar",
    base: ".aletheia/oscar/pr-antes",
    head: ".aletheia/oscar/pr-depois",
    rotulador: "packages/diff-engine/__corpus__/oscar/label-intentional.mjs",
    semDefeito: true,
  },
  // Terceiro corpus: Sauce Demo (público, com ações). Base = standard_user;
  // cada usuário é um head com defeitos documentados (faults.mjs). Capturas
  // via `node packages/diff-engine/__corpus__/saucedemo/capture.mjs`.
  ...["locked_out_user", "problem_user", "error_user", "visual_user"].map((user) => ({
    id: `saucedemo-${user}`,
    titulo: `Sauce Demo — ${user}`,
    projeto: "saucedemo",
    base: ".aletheia/saucedemo/standard_user",
    head: `.aletheia/saucedemo/${user}`,
    rotulador: "packages/diff-engine/__corpus__/saucedemo/label.mjs",
  })),
  // Quarto corpus: vite-docs (PRs reais do vitejs/vite, preview público
  // contra produção). Três PRs legítimos + o #23201, cuja preview é uma build
  // quebrada de verdade (prs.mjs). Capturas via
  // `node packages/diff-engine/__corpus__/vite-docs/capture.mjs base base-rerun 23230 …`.
  ...["23230", "23237", "23092"].map((pr) => ({
    id: `vite-docs-${pr}`,
    titulo: `Vite docs — PR real #${pr}`,
    projeto: "vite-docs",
    base: ".aletheia/vite-docs/base",
    head: `.aletheia/vite-docs/${pr}`,
    rotulador: "packages/diff-engine/__corpus__/vite-docs/label.mjs",
    semDefeito: true,
  })),
  {
    id: "vite-docs-23201",
    titulo: "Vite docs — PR real #23201 (preview quebrada)",
    projeto: "vite-docs",
    base: ".aletheia/vite-docs/base",
    head: ".aletheia/vite-docs/23201",
    rotulador: "packages/diff-engine/__corpus__/vite-docs/label.mjs",
  },
  {
    id: "juventude-piso",
    titulo: "Piso — juventude, mesma build",
    projeto: "juventude",
    base: ".aletheia/fase0/base",
    head: ".aletheia/fase0/base-rerun",
    piso: true,
  },
  {
    id: "oscar-piso",
    titulo: "Piso — oscar, mesma build",
    projeto: "oscar",
    base: ".aletheia/oscar/base",
    head: ".aletheia/oscar/base-rerun",
    piso: true,
  },
  {
    id: "saucedemo-piso",
    titulo: "Piso — Sauce Demo, mesma build",
    projeto: "saucedemo",
    base: ".aletheia/saucedemo/standard_user",
    head: ".aletheia/saucedemo/standard_user-rerun",
    piso: true,
  },
  {
    id: "vite-docs-piso",
    titulo: "Piso — Vite docs, mesma produção",
    projeto: "vite-docs",
    base: ".aletheia/vite-docs/base",
    head: ".aletheia/vite-docs/base-rerun",
    piso: true,
  },
  {
    id: "parabank-piso",
    titulo: "Piso — ParaBank, mesma build",
    base: ".aletheia/parabank/run-a",
    head: ".aletheia/parabank/run-b",
    piso: true,
  },
  {
    id: "anbima-piso",
    titulo: "Piso — ANBIMA, mesma build",
    base: ".aletheia/anbima/run-a",
    head: ".aletheia/anbima/run-b",
    piso: true,
  },
];

const args = process.argv.slice(2);
const opcao = (nome) => {
  const i = args.indexOf(nome);
  return i === -1 ? null : args[i + 1];
};
const SAIDA = resolve(opcao("--out") ?? join(ROOT, ".aletheia/_bancada"));
const ANTES = opcao("--antes");
const PARCIAL = args.includes("--parcial");

const BLOQUEANTE = new Set(["HIGH", "CRITICAL"]);
const resultados = [];
const ausentes = [];

mkdirSync(SAIDA, { recursive: true });

for (const par of PARES) {
  const base = join(ROOT, par.base, "capture.json");
  const head = join(ROOT, par.head, "capture.json");
  if (!existsSync(base) || !existsSync(head)) {
    ausentes.push(`${par.id} (${!existsSync(base) ? par.base : par.head})`);
    continue;
  }

  const dir = join(SAIDA, par.id);
  // A CLI sai com código de gate reprovado quando o veredito bloqueia. Aqui
  // isso é o resultado ESPERADO na maioria dos pares, não erro da bancada — o
  // que distingue os dois é o relatório ter sido escrito.
  try {
    execFileSync(
      process.execPath,
      [
        CLI,
        "diff",
        "--base",
        base,
        "--head",
        head,
        "--out",
        dir,
        "--env",
        "bancada",
        "--confidence-mode",
        "ISOLATED",
      ],
      { cwd: ROOT, stdio: "pipe" },
    );
  } catch (erro) {
    if (!existsSync(join(dir, "report.json"))) throw erro;
  }

  const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"));
  const linha = {
    id: par.id,
    titulo: par.titulo,
    piso: par.piso === true,
    deltas: report.deltas.length,
    regressoes: report.deltas.filter((d) => d.classification === "REGRESSION").length,
    bloqueantes: report.deltas.filter((d) => BLOQUEANTE.has(d.severity)).length,
    // Grupos por assinatura: o número que cabe na cabeça de quem triage. É
    // afirmação de "mesma causa provável", medida contra o defeito rotulado
    // logo abaixo (impuros / espalhados) — nunca cifra solta.
    grupos: report.summary.groups.total,
    gruposRegressao: report.summary.groups.REGRESSION,
  };

  if (par.rotulador !== undefined) {
    execFileSync(
      process.execPath,
      [join(ROOT, par.rotulador), join(dir, "report.json"), join(dir, "labels.json")],
      { cwd: ROOT, stdio: "pipe", maxBuffer: 64 * 1024 * 1024 },
    );
  }
  if (par.rotulador !== undefined && par.semDefeito !== true) {
    const arquivo = JSON.parse(readFileSync(join(dir, "labels.json"), "utf8"));
    const m = measure(report.deltas, arquivo.labels ?? arquivo);
    linha.bloqueados = m.blockingDefects.detected;
    linha.defeitos = m.blockingDefects.total;
    linha.perdidos = m.blockingDefects.missedIds;
    linha.triagem = m.surfacedDefects.detected;
    linha.precisao = m.blocking.precision;
    linha.falsoPositivo = m.blocking.falsePositiveRate;
    linha.naoRotulados = m.unlabeled;
    const g = assessGrouping(report.groups, arquivo.labels ?? arquivo);
    linha.gruposImpuros = g.mixedDefects.length;
    linha.gruposMistos = g.mixedWithNonRegression.length;
    linha.gruposPorDefeito = g.regressionGroupsPerDefect;
  }
  resultados.push(linha);
}

const anterior = ANTES === null ? null : lerResumo(ANTES);
const pct = (v) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`);

function lerResumo(caminho) {
  const arquivo = resolve(caminho).endsWith(".json")
    ? resolve(caminho)
    : join(resolve(caminho), "resumo.json");
  if (!existsSync(arquivo)) {
    process.stderr.write(`\n  --antes aponta para ${arquivo}, que não existe.\n\n`);
    process.exit(1);
  }
  const dados = JSON.parse(readFileSync(arquivo, "utf8"));
  return new Map((dados.pares ?? dados).map((p) => [p.id, p]));
}

/** Resumo de um par numa linha, no formato que a tabela do PR usa. */
function descrever(linha) {
  const partes = [`${linha.deltas} deltas`, `${linha.bloqueantes} bloq`];
  if (linha.gruposRegressao !== undefined) partes.push(`${linha.gruposRegressao} grupos`);
  if (linha.defeitos !== undefined) {
    partes.push(`**${linha.bloqueados} de ${linha.defeitos}**`);
    partes.push(`triagem ${linha.triagem}/${linha.defeitos}`);
    partes.push(`prec ${linha.precisao === null ? "—" : linha.precisao.toFixed(3)}`);
    partes.push(`FP ${pct(linha.falsoPositivo)}`);
  }
  return partes.join(" · ");
}

// A marca de par ausente vai DENTRO do bloco que alguém vai copiar. Deixá-la só
// no aviso abaixo produziria exatamente o que a §10.3.1 descreve: uma tabela de
// aparência completa descrevendo um ambiente pela metade.
const md = [];
md.push("");
md.push("| Corpus | Antes | Depois |");
md.push("|---|---|---|");
for (const par of PARES) {
  const linha = resultados.find((l) => l.id === par.id);
  if (linha === undefined) {
    md.push(`| ${par.titulo} | — | **NÃO MEDIDO — captura ausente** |`);
    continue;
  }
  const antes = anterior?.get(linha.id);
  md.push(
    `| ${linha.titulo} | ${antes === undefined || antes === null ? "—" : descrever(antes)} | ${descrever(linha)} |`,
  );
}

process.stdout.write("\n  bancada de medição — corpora reais, a partir das capturas em disco\n");
process.stdout.write(`${md.join("\n")}\n\n`);

const perdidos = resultados.filter((l) => (l.perdidos?.length ?? 0) > 0);
if (perdidos.length > 0) {
  process.stdout.write("  defeitos que passaram inteiros:\n");
  for (const linha of perdidos) {
    process.stdout.write(`    ${linha.id.padEnd(22)} ${linha.perdidos.join(", ")}\n`);
  }
  process.stdout.write("\n");
}

// Agrupamento contra rótulo: grupo que mistura defeitos ou mistura regressão
// com ruído é o número que diz se "N grupos" descreve N causas ou não.
const comGrupos = resultados.filter((l) => l.gruposPorDefeito !== undefined);
if (comGrupos.length > 0) {
  process.stdout.write("  agrupamento por assinatura, contra o defeito rotulado:\n");
  for (const linha of comGrupos) {
    const espalhados = Object.entries(linha.gruposPorDefeito).filter(([, n]) => n > 1);
    process.stdout.write(
      `    ${linha.id.padEnd(22)} ${linha.gruposRegressao} grupos de regressão · ` +
        `misturam defeitos: ${linha.gruposImpuros} · misturam regressão com ruído: ${linha.gruposMistos} · ` +
        `defeitos em >1 grupo de regressão: ${espalhados.length}` +
        (espalhados.length > 0 ? ` (${espalhados.map(([d, n]) => `${d}: ${n}`).join(", ")})` : "") +
        "\n",
    );
  }
  process.stdout.write("\n");
}

const naoRotulados = resultados.filter((l) => (l.naoRotulados ?? 0) > 0);
if (naoRotulados.length > 0) {
  // Delta sem rótulo não entra na conta de precisão. Se aparecerem muitos, o
  // número da tabela está descrevendo uma amostra menor do que parece.
  process.stdout.write("  deltas SEM RÓTULO (fora da conta de precisão):\n");
  for (const linha of naoRotulados) {
    process.stdout.write(`    ${linha.id.padEnd(22)} ${linha.naoRotulados}\n`);
  }
  process.stdout.write("\n");
}

const pisoSujo = resultados.filter((l) => l.piso && l.bloqueantes > 0);
if (pisoSujo.length > 0) {
  process.stdout.write("  PISO DE RUÍDO COM BLOQUEANTE — a mesma build reprovando a si mesma:\n");
  for (const linha of pisoSujo) {
    process.stdout.write(`    ${linha.id.padEnd(22)} ${linha.bloqueantes} bloqueante(s)\n`);
  }
  process.stdout.write("\n");
}

// ---------------------------------------------------------------------------
// Supressão aprendida — simulação das regras do corpus, par a par
//
// As regras em `__corpus__/<projeto>/suppressions.json` nascem PROPOSED e não
// alteram veredito nenhum; a tabela acima já é a medição real. Esta segunda
// tabela responde à pergunta do §6.4 ANTES de alguém ativar uma regra: se as
// PROPOSED/ACTIVE valessem, o que cada par perderia? "Detecção perdida" é
// delta que o motor bloqueou E o rotulador de defeito diz que é regressão —
// qualquer número acima de zero aqui é regra que não pode ser ativada.
// ---------------------------------------------------------------------------

const simulacoes = [];
for (const par of PARES) {
  const linha = resultados.find((l) => l.id === par.id);
  if (linha === undefined || par.projeto === undefined) continue;
  const arquivoRegras = join(
    ROOT,
    `packages/diff-engine/__corpus__/${par.projeto}/suppressions.json`,
  );
  if (!existsSync(arquivoRegras)) continue;

  const dir = join(SAIDA, par.id);
  const set = parseSuppressionSet(JSON.parse(readFileSync(arquivoRegras, "utf8")), arquivoRegras);
  const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"));
  const rotulos = existsSync(join(dir, "labels.json"))
    ? (JSON.parse(readFileSync(join(dir, "labels.json"), "utf8")).labels ?? null)
    : null;
  const sim = simulateSuppression(set, report, rotulos);
  const pendentes = set.rules.filter((r) => r.status === "PROPOSED" || r.status === "ACTIVE");
  simulacoes.push({
    id: par.id,
    titulo: par.titulo,
    projeto: par.projeto,
    regras: pendentes.map((r) => r.id),
    ativas: set.rules.filter((r) => r.status === "ACTIVE").length,
    suprimiria: sim.wouldSuppress.length,
    bloqueantesHoje: linha.regressoes,
    bloqueantesDepois: sim.regressionsRemaining,
    detecaoPerdida: sim.trueRegressionsLost.length,
    rotulado: rotulos !== null,
  });
}

if (simulacoes.length > 0) {
  process.stdout.write(
    "  supressão aprendida — SIMULAÇÃO das regras PROPOSED/ACTIVE do corpus (não altera a tabela acima)\n\n",
  );
  process.stdout.write(
    "| Par | Regras | Suprimiria | Bloqueantes hoje → se valessem | Detecção perdida |\n",
  );
  process.stdout.write("|---|---|---|---|---|\n");
  for (const s of simulacoes) {
    let perdida = "sem rótulo — desconhecida";
    if (s.rotulado) perdida = s.detecaoPerdida > 0 ? `**${s.detecaoPerdida} — NÃO ATIVAR**` : "0";
    process.stdout.write(
      `| ${s.titulo} | ${s.regras.length} (${s.ativas} ativa(s)) | ${s.suprimiria} | ${s.bloqueantesHoje} → ${s.bloqueantesDepois} | ${perdida} |\n`,
    );
  }
  process.stdout.write("\n");
  if (simulacoes.some((s) => s.detecaoPerdida > 0)) {
    process.stdout.write(
      "  DETECÇÃO PERDIDA EM SIMULAÇÃO — alguma regra proposta apagaria regressão real rotulada.\n" +
        "  Ela não pode ser ativada (CLAUDE.md §6.4). Veja `aletheia suppress simulate` no par.\n\n",
    );
  }
}

writeFileSync(
  join(SAIDA, "resumo.json"),
  `${JSON.stringify(
    { completo: ausentes.length === 0, ausentes, pares: resultados, supressaoSimulada: simulacoes },
    null,
    2,
  )}\n`,
  "utf8",
);

process.stdout.write(
  "  Esta bancada NÃO substitui a §11 de docs/medicao-fase-0.md: as capturas\n" +
    "  vêm de lá, e sem elas não há o que medir. Ela também não é gate — quem\n" +
    "  reprova no CI é `pnpm corpus:gate`, contra fixtures versionados.\n\n" +
    `  artefatos em ${SAIDA}\n\n`,
);

if (ausentes.length > 0) {
  const aviso =
    `  TABELA INCOMPLETA — ${ausentes.length} par(es) sem captura em disco:\n` +
    ausentes.map((a) => `    - ${a}\n`).join("") +
    "\n  Reconstitua com os comandos da §11 de docs/medicao-fase-0.md antes de\n" +
    "  colar esta tabela em PR nenhum. Par que falta não é par que passou.\n\n";
  if (PARCIAL) {
    process.stdout.write(aviso);
    process.exit(0);
  }
  process.stderr.write(aviso);
  process.exit(1);
}
