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

const { measure } = await import(
  pathToFileURL(join(ROOT, "packages/diff-engine/dist/index.js")).href
);

/**
 * Os pares, na ordem em que o `PULL_REQUEST_TEMPLATE` os cobra.
 *
 * `rotulador` só existe onde HÁ defeito aplicado. Nos pares de mudança
 * intencional e nos pisos de ruído não há o que rotular — e é de propósito: o
 * número lá é um só, quantos deltas o motor classificou como `REGRESSION`, e
 * todo ele é falso positivo por construção.
 */
const PARES = [
  {
    id: "juventude-defeitos",
    titulo: "Juventude — 9 defeitos",
    base: ".aletheia/fase0/base",
    head: ".aletheia/fase0/head",
    rotulador: "packages/diff-engine/__corpus__/juventude/label.mjs",
  },
  {
    id: "juventude-pr2",
    titulo: "Juventude — PR real #2 (910181f)",
    base: ".aletheia/fase0/pr2-antes",
    head: ".aletheia/fase0/pr2-depois",
  },
  {
    id: "oscar-defeitos",
    titulo: "Oscar — 7 defeitos",
    base: ".aletheia/oscar/base",
    head: ".aletheia/oscar/head",
    rotulador: "packages/diff-engine/__corpus__/oscar/label.mjs",
  },
  {
    id: "oscar-intencional",
    titulo: "Oscar — mudança intencional",
    base: ".aletheia/oscar/pr-antes",
    head: ".aletheia/oscar/pr-depois",
  },
  {
    id: "juventude-piso",
    titulo: "Piso — juventude, mesma build",
    base: ".aletheia/fase0/base",
    head: ".aletheia/fase0/base-rerun",
    piso: true,
  },
  {
    id: "oscar-piso",
    titulo: "Piso — oscar, mesma build",
    base: ".aletheia/oscar/base",
    head: ".aletheia/oscar/base-rerun",
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
  };

  if (par.rotulador !== undefined) {
    execFileSync(
      process.execPath,
      [join(ROOT, par.rotulador), join(dir, "report.json"), join(dir, "labels.json")],
      { cwd: ROOT, stdio: "pipe", maxBuffer: 64 * 1024 * 1024 },
    );
    const arquivo = JSON.parse(readFileSync(join(dir, "labels.json"), "utf8"));
    const m = measure(report.deltas, arquivo.labels ?? arquivo);
    linha.bloqueados = m.blockingDefects.detected;
    linha.defeitos = m.blockingDefects.total;
    linha.perdidos = m.blockingDefects.missedIds;
    linha.triagem = m.surfacedDefects.detected;
    linha.precisao = m.blocking.precision;
    linha.falsoPositivo = m.blocking.falsePositiveRate;
    linha.naoRotulados = m.unlabeled;
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

writeFileSync(
  join(SAIDA, "resumo.json"),
  `${JSON.stringify({ completo: ausentes.length === 0, ausentes, pares: resultados }, null, 2)}\n`,
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
