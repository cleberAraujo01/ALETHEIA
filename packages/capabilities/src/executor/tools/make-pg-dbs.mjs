#!/usr/bin/env node
/**
 * Versão PostgreSQL de `apps/runner/__fixtures__/site/make-dbs.mjs` (mora aqui
 * porque é o pacote que tem o driver `pg`): cria dois bancos TEMPLATE no servidor
 * apontado por `ALETHEIA_PG_URL` (`aletheia_demo_base`, `aletheia_demo_head`)
 * com os mesmos dados — desconto do pedido 42 15% → 10%, um pedido a mais no
 * head. Imprime as duas URLs. Fecha toda conexão antes de sair: template com
 * conexão ativa não clona.
 */
import pg from "pg";

const url = process.env["ALETHEIA_PG_URL"];
if (url === undefined) {
  process.stderr.write("ALETHEIA_PG_URL ausente\n");
  process.exit(2);
}
const admin = new URL(url);
admin.pathname = "/postgres";

async function make(name, discount42, extra) {
  const control = new pg.Client({ connectionString: admin.toString() });
  await control.connect();
  await control.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await control.query(`CREATE DATABASE "${name}"`);
  await control.end();
  const target = new URL(url);
  target.pathname = `/${name}`;
  const seed = new pg.Client({ connectionString: target.toString() });
  await seed.connect();
  await seed.query(
    "CREATE TABLE orders (id INTEGER PRIMARY KEY, discount_pct INTEGER, total_cents INTEGER, customer_email TEXT, created_at TEXT)",
  );
  await seed.query("INSERT INTO orders VALUES (41, 0, 20000, 'ana@exemplo.com', $1)", [
    `2026-01-01 ${name}`,
  ]);
  await seed.query("INSERT INTO orders VALUES (42, $1, 10000, 'bia@exemplo.com', $2)", [
    discount42,
    `2026-01-02 ${name}`,
  ]);
  if (extra)
    await seed.query("INSERT INTO orders VALUES (43, 5, 5000, 'caio@exemplo.com', $1)", [
      `2026-01-03 ${name}`,
    ]);
  await seed.end();
  return target.toString();
}

process.stdout.write(
  `${await make("aletheia_demo_base", 15, false)}\n${await make("aletheia_demo_head", 10, true)}\n`,
);
