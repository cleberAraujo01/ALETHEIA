#!/usr/bin/env node
/**
 * Produz a build `pr-antes` do corpus de mudança intencional do `oscar`,
 * aplicando a transformação INVERSA das quatro mudanças reais declaradas em
 * `intentional.mjs` sobre uma cópia do django-oscar.
 *
 *   node apply-intentional.mjs <diretório do clone do django-oscar>
 *
 * A build `pr-depois` é o template como está — nada a fazer. Portanto:
 *
 *   1. capture `pr-depois` com o clone limpo;
 *   2. rode este script;
 *   3. capture `pr-antes`;
 *   4. `git checkout -- src/` no clone;
 *   5. diff de `pr-antes` para `pr-depois`.
 *
 * A ordem importa: capturar `pr-depois` primeiro evita depender de o `checkout`
 * ter restaurado tudo antes da captura que interessa.
 *
 * O QUE ESTE NÚMERO SIGNIFICA. Nenhuma destas mudanças é defeito, então
 * **qualquer delta bloqueante aqui é falso positivo do motor**. É o único
 * experimento do corpus `oscar` que mede isso: o piso de ruído usa a mesma
 * build, e o corpus de defeito não tem mudança legítima nenhuma.
 *
 * Toda substituição é exata e verificada, pelo mesmo motivo de
 * `apply-faults.mjs`: conjunto pela metade invalidaria a medição em silêncio.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CHANGES, CHANGE_COUNT } from "./intentional.mjs";

const target = process.argv[2];
if (target === undefined) {
  process.stderr.write("uso: node apply-intentional.mjs <diretório do clone do django-oscar>\n");
  process.exit(2);
}

const root = resolve(target);
const applied = [];

for (const change of CHANGES) {
  for (const edit of change.edits) {
    const path = resolve(root, edit.file);
    const original = await readFile(path, "utf8");
    const crlf = original.includes("\r\n");
    const before = crlf ? original.replaceAll("\r\n", "\n") : original;
    const occurrences = before.split(edit.from).length - 1;

    if (occurrences === 0) {
      process.stderr.write(
        `\n  mudança ${change.id}: trecho não encontrado em ${edit.file}\n` +
          `  procurado: ${JSON.stringify(edit.from.slice(0, 80))}\n\n`,
      );
      process.exit(2);
    }
    if (occurrences > 1 && edit.all !== true) {
      process.stderr.write(
        `\n  mudança ${change.id}: ${occurrences} ocorrências em ${edit.file}; ` +
          `o trecho precisa ser único (ou declare all: true)\n\n`,
      );
      process.exit(2);
    }

    const after =
      edit.all === true ? before.split(edit.from).join(edit.to) : before.replace(edit.from, edit.to);
    await writeFile(path, crlf ? after.replaceAll("\n", "\r\n") : after, "utf8");
  }
  applied.push(change);
}

process.stdout.write(
  `\n  revertidas  ${applied.length} de ${CHANGE_COUNT} mudanças intencionais em ${root}\n` +
    `  a build agora é 'pr-antes' — o estado ANTERIOR a cada mudança\n\n` +
    applied.map((change) => `    ${change.id}\n      ${change.commit}`).join("\n") +
    "\n\n  nenhuma delas é defeito: delta bloqueante no diff é falso positivo do motor\n\n",
);
