#!/usr/bin/env node
/**
 * Captura o corpus `saucedemo` — `node capture.mjs [usuario ...]`.
 *
 * Uma captura por usuário em `.aletheia/saucedemo/<usuario>/`, mais
 * `standard_user-rerun` (piso de ruído: a base contra ela mesma). Sem build,
 * sem login manual: a jornada faz o login. Custa ~30 s por usuário contra o
 * site público — é a metade "cara" deste corpus, e é barata.
 */
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { USERS } from "./journey.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const CLI = join(ROOT, "shims/cli/dist/main.js");
const OUT = join(ROOT, ".aletheia/saucedemo");
const BASE_URL = "https://www.saucedemo.com";

const targets =
  process.argv.slice(2).length > 0 ? process.argv.slice(2) : [...USERS, "standard_user-rerun"];

for (const target of targets) {
  const user = target.replace(/-rerun$/, "");
  const label = target === "standard_user" ? "base" : target;
  process.stdout.write(`\n  capturando ${target}…\n`);
  execFileSync(
    process.execPath,
    [
      CLI,
      "capture",
      "--url",
      BASE_URL,
      "--journey",
      join(HERE, "journeys", `${user}.json`),
      "--out",
      join(OUT, target),
      "--label",
      label,
      "--seed",
      "42",
    ],
    { cwd: ROOT, stdio: ["ignore", "inherit", "pipe"] },
  );
}
