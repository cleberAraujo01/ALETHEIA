#!/usr/bin/env node
/**
 * Gate de regressão de corpus — `pnpm corpus:gate`.
 *
 * CLAUDE.md §6.4 exige que toda mudança no `diff-engine` reporte delta de
 * precisão e recall. Exigência que depende de alguém lembrar é exigência que um
 * dia falha em silêncio; este script torna a parte automatizável dela
 * verificável pelo CI.
 *
 * O QUE ELE MEDE, E O QUE NÃO MEDE — leia antes de confiar no verde.
 *
 * Ele roda contra o corpus SINTÉTICO versionado
 * (`packages/diff-engine/__fixtures__/checkout/`), não contra os corpora reais.
 * A razão é declarada e foi decidida, não improvisada: capturas reais pesam de
 * 2,5 a 6 MB cada, sete delas passam de 28 MB, e §11 de `docs/medicao-fase-0.md`
 * registra a decisão de não versioná-las. Reconstituí-las no CI exigiria clonar
 * duas aplicações, subir Django e rodar Playwright — não cabe no orçamento de
 * tempo nem faz sentido num gate de PR.
 *
 * Portanto: **este gate pega regressão grosseira, não pega deslocamento fino.**
 * A medição real continua sendo obrigação de quem abre o PR, e o
 * PULL_REQUEST_TEMPLATE cobra a tabela dos quatro pares com os números de hoje
 * já preenchidos. O gate é a rede de baixo, não o exame.
 *
 * POR QUE ELE EXISTE SE `pnpm test` JÁ ASSERTA O MESMO CORPUS. O teste checa
 * limites ("≥ 5 regressões"). Este gate compara NÚMEROS EXATOS contra um
 * baseline versionado, então uma queda de 8 para 6 regressões — que passa
 * folgada no teste — falha aqui. Deslocamento silencioso dentro do limite é
 * exatamente como detecção se perde sem ninguém perceber.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseCapture, runDiff } from "@aletheia/diff-engine";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(ROOT, "packages/diff-engine/__fixtures__/checkout");
const BASELINE = join(ROOT, "packages/diff-engine/__fixtures__/baseline.json");

const METADATA = {
  runId: "run_corpus_gate",
  worldModelVersion: null,
  irVersion: null,
  runnerVersion: "0.0.0-gate",
  browserVersion: null,
  seed: "0",
  commit: "gate",
  baseRef: "main",
  environment: "ci",
  confidenceMode: "ISOLATED",
  autonomyLevel: 1,
  startedAtUtc: "2026-01-10T12:10:00.000Z",
};

const load = (name) =>
  parseCapture(JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")), name);

function measure(baseName, headName) {
  const report = runDiff(load(baseName), load(headName), { metadata: METADATA });
  const bySeverity = {};
  for (const delta of report.deltas) {
    bySeverity[delta.severity] = (bySeverity[delta.severity] ?? 0) + 1;
  }
  return {
    deltas: report.deltas.length,
    regressoes: report.deltas.filter((d) => d.classification === "REGRESSION").length,
    bloqueantes: report.deltas.filter((d) => d.severity === "HIGH" || d.severity === "CRITICAL")
      .length,
    bloqueiaOVeredito: report.verdict.blocking,
    bySeverity,
  };
}

const atual = {
  defeitos: measure("base", "head-with-regressions"),
  pisoDeRuido: measure("base", "base-rerun"),
};

if (process.argv.includes("--write-baseline")) {
  writeFileSync(
    BASELINE,
    `${JSON.stringify(
      {
        _origem:
          "Gerado por scripts/corpus-gate.mjs --write-baseline. Alterar este arquivo " +
          "muda o que o CI aceita: exige justificativa no corpo do PR (CLAUDE.md §11).",
        ...atual,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  process.stdout.write(`\n  baseline gravado em ${BASELINE}\n\n`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
const problemas = [];

// Detecção não pode cair. Detectar menos é perder o produto em silêncio.
if (atual.defeitos.regressoes < baseline.defeitos.regressoes) {
  problemas.push(
    `Detecção CAIU: ${baseline.defeitos.regressoes} → ${atual.defeitos.regressoes} regressões no corpus de defeitos.\n` +
      "    Falso negativo é pior que falso positivo (PA-10). Se a queda é intencional,\n" +
      "    o baseline muda no MESMO PR, com justificativa no corpo.",
  );
}
if (!atual.defeitos.bloqueiaOVeredito) {
  problemas.push(
    "O corpus de defeitos deixou de produzir veredito bloqueante.\n" +
      "    O motor parou de reprovar uma build que tem regressão conhecida.",
  );
}

// Piso de ruído: a mesma build não pode reprovar a si mesma. É o pior falso
// positivo possível — não precisa nem de deploy para destruir a confiança.
if (atual.pisoDeRuido.bloqueantes > baseline.pisoDeRuido.bloqueantes) {
  problemas.push(
    `Piso de ruído PIOROU: ${baseline.pisoDeRuido.bloqueantes} → ${atual.pisoDeRuido.bloqueantes} deltas bloqueantes entre duas capturas da MESMA build.`,
  );
}
if (atual.pisoDeRuido.deltas > baseline.pisoDeRuido.deltas) {
  problemas.push(
    `Ruído total subiu no piso: ${baseline.pisoDeRuido.deltas} → ${atual.pisoDeRuido.deltas} deltas na mesma build.`,
  );
}

const linha = (rotulo, antes, depois) => {
  const seta = antes === depois ? "=" : depois > antes ? "↑" : "↓";
  return `    ${rotulo.padEnd(34)} ${String(antes).padStart(4)} → ${String(depois).padStart(4)}  ${seta}\n`;
};

process.stdout.write("\n  gate de corpus — fixtures sintéticos versionados\n\n");
process.stdout.write(linha("defeitos: deltas", baseline.defeitos.deltas, atual.defeitos.deltas));
process.stdout.write(
  linha("defeitos: regressões", baseline.defeitos.regressoes, atual.defeitos.regressoes),
);
process.stdout.write(
  linha("defeitos: bloqueantes", baseline.defeitos.bloqueantes, atual.defeitos.bloqueantes),
);
process.stdout.write(
  linha("piso de ruído: deltas", baseline.pisoDeRuido.deltas, atual.pisoDeRuido.deltas),
);
process.stdout.write(
  linha(
    "piso de ruído: bloqueantes",
    baseline.pisoDeRuido.bloqueantes,
    atual.pisoDeRuido.bloqueantes,
  ),
);

process.stdout.write(
  "\n  Este gate NÃO substitui a medição contra os corpora reais — ela continua\n" +
    "  sendo obrigação de quem abre o PR (PULL_REQUEST_TEMPLATE, §11 da medição).\n",
);

if (problemas.length === 0) {
  process.stdout.write("\n  sem regressão\n\n");
  process.exit(0);
}

process.stderr.write(`\n  ${problemas.length} REGRESSÃO(ÕES) DE CORPUS\n\n`);
for (const problema of problemas) process.stderr.write(`  - ${problema}\n`);
process.stderr.write("\n");
process.exit(1);
