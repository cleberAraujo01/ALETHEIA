#!/usr/bin/env node
/**
 * Corpus `vite-docs` — PRs LEGÍTIMOS reais, capturados de previews públicos.
 *
 *   node capture.mjs base            → produção (vite.dev), rótulo `base`
 *   node capture.mjs base-rerun      → produção de novo (piso de ruído)
 *   node capture.mjs 23230 [23237…]  → preview Netlify do PR, rótulo `pr-<n>`,
 *                                      e grava prs/<n>.json (título, shas,
 *                                      arquivos alterados) para o rotulador
 *
 * A documentação do Vite publica um deploy preview por PR
 * (`deploy-preview-<n>--vite-docs-main.netlify.app`), público. Base =
 * produção; head = preview. O plano era só PR legítimo — mais PRs de outra
 * aplicação para o placar de falso positivo (§10.9 da Fase 0) e para a
 * supressão aprendida ter evidência de execuções distintas. Um dos quatro
 * (#23201) revelou-se uma build quebrada de verdade; ver `prs.mjs`.
 *
 * O que fica declarado: é site de documentação (VitePress), jornada por URL,
 * e o preview é construído do head do PR — que pode estar atrás da main que a
 * produção mostra. Diferença que não é do PR nem é ruído do motor é "drift"
 * de outros commits mesclados; o rotulador a marca como INTENDED_CHANGE.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const CLI = join(ROOT, "shims/cli/dist/main.js");
const OUT = join(ROOT, ".aletheia/vite-docs");
const PRODUCTION = "https://vite.dev";
const previewOf = (pr) => `https://deploy-preview-${pr}--vite-docs-main.netlify.app`;

const targets = process.argv.slice(2);
if (targets.length === 0) {
  process.stderr.write("uso: node capture.mjs base | base-rerun | <número do PR> ...\n");
  process.exit(2);
}

for (const target of targets) {
  let url = PRODUCTION;
  let label = target;
  if (/^\d+$/.test(target)) {
    url = previewOf(target);
    label = `pr-${target}`;
    const meta = JSON.parse(
      execFileSync("gh", ["api", `repos/vitejs/vite/pulls/${target}`], { encoding: "utf8" }),
    );
    const files = JSON.parse(
      execFileSync("gh", ["api", `repos/vitejs/vite/pulls/${target}/files?per_page=100`], {
        encoding: "utf8",
      }),
    ).map((f) => f.filename);
    mkdirSync(join(HERE, "prs"), { recursive: true });
    writeFileSync(
      join(HERE, "prs", `${target}.json`),
      `${JSON.stringify(
        {
          pr: Number(target),
          title: meta.title,
          headSha: meta.head.sha,
          baseSha: meta.base.sha,
          preview: url,
          capturedProduction: PRODUCTION,
          files,
        },
        null,
        2,
      )}\n`,
    );
  } else if (target !== "base" && target !== "base-rerun") {
    process.stderr.write(`  alvo desconhecido: ${target}\n`);
    process.exit(2);
  }
  const status = await fetch(`${url}/`, { method: "GET", redirect: "manual" })
    .then((response) => String(response.status))
    .catch(() => "000");
  if (status !== "200") {
    process.stderr.write(
      `  ${target}: ${url} respondeu ${status} — preview cancelado/expirado? pulando\n`,
    );
    continue;
  }
  process.stdout.write(`\n  capturando ${target} (${url})…\n`);
  // O vite.dev converge no limite do deadline (prefetch em idle, rede
  // variável): TIMEOUT_CONVERGENCE acontece de vez em quando e é falha de
  // plataforma, não veredito. Aqui, tenta de novo uma vez e segue para o
  // próximo alvo — a captura que faltar aparece como par ausente na bancada.
  let ok = false;
  for (let attempt = 1; attempt <= 2 && !ok; attempt += 1) {
    try {
      execFileSync(
        process.execPath,
        [
          CLI,
          "capture",
          "--url",
          url,
          "--journey",
          join(HERE, "journey.json"),
          "--out",
          join(OUT, target),
          "--label",
          label,
          "--seed",
          "42",
        ],
        { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] },
      );
      ok = existsSync(join(OUT, target, "capture.json"));
    } catch {
      process.stdout.write(`  tentativa ${attempt} de ${target} falhou (ver acima)\n`);
    }
  }
  if (!ok) process.stdout.write(`  ${target}: sem captura após 2 tentativas\n`);
}
