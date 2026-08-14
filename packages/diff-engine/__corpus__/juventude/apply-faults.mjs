#!/usr/bin/env node
/**
 * Aplica o conjunto de defeitos do corpus `juventude` sobre uma cópia da
 * aplicação real, produzindo a build `head` da medição de saída da Fase 0.
 *
 *   node apply-faults.mjs <diretório da cópia da aplicação>
 *
 * Diferença essencial em relação a `tools/mutate-capture.mjs`: aquele mutila o
 * artefato de captura, o que prova o motor de diff e nada mais. Este altera o
 * **código-fonte** e obriga a passar por build, renderização, navegador e
 * captura — o mesmo caminho de um defeito de verdade. Um defeito que só existe
 * no JSON nunca produz o efeito colateral que o defeito real produz.
 *
 * Toda substituição é exata e verificada: se um trecho não bater (porque a
 * aplicação mudou), o script falha em vez de aplicar defeito pela metade. Um
 * conjunto aplicado parcialmente invalidaria a medição em silêncio.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { FAULTS, FAULT_COUNT } from "./faults.mjs";

const target = process.argv[2];
if (target === undefined) {
  process.stderr.write("uso: node apply-faults.mjs <diretório da aplicação>\n");
  process.exit(2);
}

const root = resolve(target);
const applied = [];

for (const fault of FAULTS) {
  for (const edit of fault.edits) {
    const path = resolve(root, edit.file);
    const original = await readFile(path, "utf8");
    // O corpus declara os trechos com LF. Um checkout Windows entrega CRLF e a
    // substituição falharia por um caractere invisível — normaliza para casar e
    // devolve o arquivo no formato em que estava.
    const crlf = original.includes("\r\n");
    const before = crlf ? original.replaceAll("\r\n", "\n") : original;
    const occurrences = before.split(edit.from).length - 1;

    if (occurrences === 0) {
      process.stderr.write(
        `\n  defeito ${fault.id}: trecho não encontrado em ${edit.file}\n` +
          `  procurado: ${JSON.stringify(edit.from.slice(0, 80))}\n\n`,
      );
      process.exit(2);
    }
    if (occurrences > 1 && edit.all !== true) {
      process.stderr.write(
        `\n  defeito ${fault.id}: ${occurrences} ocorrências em ${edit.file}; ` +
          `o trecho precisa ser único (ou declare all: true)\n\n`,
      );
      process.exit(2);
    }

    const after =
      edit.all === true
        ? before.split(edit.from).join(edit.to)
        : before.replace(edit.from, edit.to);
    await writeFile(path, crlf ? after.replaceAll("\n", "\r\n") : after, "utf8");
  }
  applied.push(fault);
}

process.stdout.write(
  `\n  aplicados   ${applied.length} defeitos em ${root}\n` +
    `  histórico   ${FAULT_COUNT.historico} (estiveram em produção nesta aplicação)\n` +
    `  injetado    ${FAULT_COUNT.injetado} (plantados; nunca estiveram em produção)\n\n` +
    applied
      .map((fault) => `    ${fault.origem === "HISTORICO" ? "H" : "I"}  ${fault.id}`)
      .join("\n") +
    "\n\n",
);
