#!/usr/bin/env node
/**
 * Dois bancos sqlite para o demo de diff de banco (E-02): base e head iguais
 * exceto pelo DESCONTO DO PEDIDO 42 (15% → 10%) — o caso central do problema do
 * oráculo — e por um pedido a mais no head. `created_at` difere de propósito:
 * é coluna volátil declarada na capability e não pode virar delta.
 *
 *   node apps/runner/__fixtures__/site/make-dbs.mjs <dir>
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const dir = process.argv[2];
if (dir === undefined) {
  process.stderr.write("uso: node make-dbs.mjs <dir>\n");
  process.exit(2);
}
mkdirSync(dir, { recursive: true });

function make(file, discount42, extra) {
  const path = join(dir, file);
  rmSync(path, { force: true });
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE orders (id INTEGER PRIMARY KEY, discount_pct INTEGER, total_cents INTEGER, customer_email TEXT, created_at TEXT);",
  );
  const insert = db.prepare("INSERT INTO orders VALUES (?, ?, ?, ?, ?)");
  insert.run(41, 0, 20000, "ana@exemplo.com", `2026-01-01 ${file}`);
  insert.run(42, discount42, 10000, "bia@exemplo.com", `2026-01-02 ${file}`);
  if (extra) insert.run(43, 5, 5000, "caio@exemplo.com", `2026-01-03 ${file}`);
  db.close();
  return path;
}

const base = make("base.db", 15, false);
const head = make("head.db", 10, true);
process.stdout.write(`${base}\n${head}\n`);
