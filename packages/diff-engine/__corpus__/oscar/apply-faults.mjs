#!/usr/bin/env node
/**
 * Aplica o conjunto de defeitos do corpus `oscar` sobre uma cópia do sandbox do
 * django-oscar, produzindo a build `head` do segundo corpus da Fase 0.
 *
 *   node apply-faults.mjs <diretório do clone do django-oscar>
 *
 * Aqui o defeito está no **template**, não no artefato de captura: passa por
 * renderização no servidor, navegador e captura, como um defeito de verdade.
 *
 * Diferença operacional em relação ao corpus `juventude`: Django recarrega
 * template a cada request, então não há passo de build entre aplicar o defeito e
 * observar o resultado — basta reiniciar o servidor se ele estiver com
 * `--noreload`. Isso torna o ciclo mais barato, e é uma das razões de esta ser
 * uma boa segunda aplicação.
 *
 * Toda substituição é exata e verificada: se um trecho não bater (porque o
 * django-oscar mudou de versão), o script falha em vez de aplicar o conjunto
 * pela metade. Um conjunto parcial invalidaria a medição em silêncio.
 *
 * Para desfazer, use o git do próprio clone (`git checkout -- src/`). Não existe
 * rotina de limpeza aqui de propósito (PA-06): a cópia é descartável.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { FAULTS, FAULT_COUNT } from "./faults.mjs";

const target = process.argv[2];
if (target === undefined) {
  process.stderr.write("uso: node apply-faults.mjs <diretório do clone do django-oscar>\n");
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
      edit.all === true ? before.split(edit.from).join(edit.to) : before.replace(edit.from, edit.to);
    await writeFile(path, crlf ? after.replaceAll("\n", "\r\n") : after, "utf8");
  }
  applied.push(fault);
}

process.stdout.write(
  `\n  aplicados   ${applied.length} defeitos em ${root}\n` +
    `  histórico   ${FAULT_COUNT.historico} (estiveram em produção nesta aplicação)\n` +
    `  injetado    ${FAULT_COUNT.injetado} (plantados; nunca estiveram em produção)\n\n` +
    applied.map((fault) => `    ${fault.origem === "HISTORICO" ? "H" : "I"}  ${fault.id}`).join("\n") +
    "\n\n",
);
