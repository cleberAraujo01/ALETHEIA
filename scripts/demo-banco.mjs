#!/usr/bin/env node
/**
 * Demo do diff de banco (E-02) — `pnpm demo:banco`.
 *
 * O caso central do problema do oráculo (CLAUDE.md §1): a tela é a MESMA nas
 * duas builds, e o desconto do pedido 42 está errado no banco do head (15% →
 * 10%). Nenhum teste de UI pega isso; a capability READ aprovada
 * (`order.getDiscount`) pega, e o gate reprova.
 *
 * O que ele faz: cria dois sqlite (base/head) com `make-dbs.mjs`, sobe um
 * servidor estático com o fixture do runner, roda `aletheia run` com
 * `--base-db`/`--head-db`/`--capabilities`, e imprime o comentário de PR. É
 * também o smoke local da fatia; a versão de teste (sem CLI) está em
 * `apps/runner/src/capture.test.ts` e `packages/capabilities`.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "shims/cli/dist/main.js");
const SITE = join(ROOT, "apps/runner/__fixtures__/site");
const work = mkdtempSync(join(tmpdir(), "aletheia-demo-banco-"));

execFileSync(process.execPath, [join(SITE, "make-dbs.mjs"), join(work, "dbs")], { stdio: "pipe" });

const server = spawn(process.execPath, [join(SITE, "serve.mjs")], {
  stdio: ["ignore", "pipe", "inherit"],
});
const port = await new Promise((resolvePort) => {
  server.stdout.once("data", (chunk) => resolvePort(String(chunk).trim()));
});

let status = 0;
try {
  execFileSync(
    process.execPath,
    [
      CLI,
      "run",
      "--base-url",
      `http://127.0.0.1:${port}`,
      "--head-url",
      `http://127.0.0.1:${port}`,
      "--journey",
      join(ROOT, "apps/runner/__fixtures__/journeys/fixture-loja.json"),
      "--capabilities",
      join(ROOT, "apps/runner/__fixtures__/capabilities"),
      "--base-db",
      `sqlite:${join(work, "dbs/base.db")}`,
      "--head-db",
      `sqlite:${join(work, "dbs/head.db")}`,
      "--out",
      join(work, "run"),
      "--env",
      "demo",
      "--screenshots",
      "false",
    ],
    { cwd: ROOT, stdio: ["ignore", "inherit", "ignore"] },
  );
} catch (error) {
  status = typeof error?.status === "number" ? error.status : 2;
} finally {
  server.kill();
}

process.stdout.write(`\n${readFileSync(join(work, "run/comment.md"), "utf8")}\n`);
process.stdout.write(
  `  código de saída do runner: ${status} — ${status === 1 ? "REGRESSÃO (esperado: o desconto do pedido 42 mudou no banco)" : status === 0 ? "sem regressão (INESPERADO)" : "falha de plataforma"}\n` +
    `  artefatos em ${join(work, "run")}\n\n`,
);
process.exit(status === 1 ? 0 : 1);
