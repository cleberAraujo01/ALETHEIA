#!/usr/bin/env node
/**
 * Corpus `excalidraw` — PRs reais com PAR EXATO, capturados de previews públicos.
 *
 *   node capture.mjs 12143 [12125 …]   → base = preview do merge-base do PR
 *                                        (`base-<sha7>`, capturada uma vez por
 *                                        sha), head = preview do head do PR
 *                                        (`pr-<n>`); grava prs/<n>.json
 *   node capture.mjs piso              → a base `PISO_SHA` de novo
 *                                        (`base-<sha7>-rerun`): piso de ruído
 *
 * Como se acha o preview: a integração da Vercel registra um deployment na
 * API do GitHub por commit (`/repos/{repo}/deployments?sha=`), com o
 * `environment_url` no status. Serve para o head do PR (build do fork) e
 * para o commit da `master` que é o merge-base — é isso que dá o par exato.
 * Só o ambiente "Preview – excalidraw" interessa; os "package-example" são
 * outra aplicação.
 *
 * O que fica declarado: a UI sai no idioma do browser (pt-BR aqui), igual
 * nos dois lados; a jornada tem ações (menu, tecla `?`, mais ferramentas) e
 * o canvas em si não está no DOM — o que se compara é a moldura da
 * aplicação, a rede e o console.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PISO_SHA, PRS, REPO } from "./prs.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const CLI = join(ROOT, "shims/cli/dist/main.js");
const OUT = join(ROOT, ".aletheia/excalidraw");

const gh = (path) => JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8" }));

/** URL do preview da aplicação para um commit, ou null se a Vercel não o construiu. */
function previewOf(sha) {
  const deployments = gh(`repos/${REPO}/deployments?sha=${sha}&per_page=20`).filter(
    (d) => /Preview/.test(d.environment) && !/package/.test(d.environment),
  );
  for (const d of deployments) {
    const status = gh(`repos/${REPO}/deployments/${d.id}/statuses`)[0];
    if (status?.state === "success" && status.environment_url) return status.environment_url;
  }
  return null;
}

async function alive(url) {
  const status = await fetch(`${url}/`, { method: "GET", redirect: "manual" })
    .then((r) => String(r.status))
    .catch(() => "000");
  return status === "200";
}

async function capture(url, dir, label) {
  if (!(await alive(url))) {
    process.stdout.write(`  ${label}: ${url} não respondeu 200 — preview expirado? pulando\n`);
    return false;
  }
  process.stdout.write(`\n  capturando ${label} (${url})…\n`);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
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
          dir,
          "--label",
          label,
          "--seed",
          "42",
        ],
        { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] },
      );
      if (existsSync(join(dir, "capture.json"))) return true;
    } catch {
      process.stdout.write(`  tentativa ${attempt} de ${label} falhou (ver acima)\n`);
    }
  }
  process.stdout.write(`  ${label}: sem captura após 2 tentativas\n`);
  return false;
}

const fullSha = (sha7) => gh(`repos/${REPO}/commits/${sha7}`).sha;

const targets = process.argv.slice(2);
if (targets.length === 0) {
  process.stderr.write("uso: node capture.mjs <número do PR> ... | piso\n");
  process.exit(2);
}

for (const target of targets) {
  if (target === "piso") {
    const url = previewOf(fullSha(PISO_SHA));
    if (url === null) {
      process.stderr.write(`  piso: sem preview para ${PISO_SHA}\n`);
      continue;
    }
    await capture(url, join(OUT, `base-${PISO_SHA}-rerun`), `base-${PISO_SHA}-rerun`);
    continue;
  }
  if (!/^\d+$/.test(target) || PRS[target] === undefined) {
    process.stderr.write(
      `  ${target} não é PR do corpus (${Object.keys(PRS).join(", ")}) nem "piso"\n`,
    );
    process.exit(2);
  }
  const meta = gh(`repos/${REPO}/pulls/${target}`);
  const baseSha = gh(`repos/${REPO}/compare/${meta.base.sha}...${meta.head.sha}`).merge_base_commit
    .sha;
  const base7 = baseSha.slice(0, 7);
  if (base7 !== PRS[target].baseSha) {
    process.stderr.write(
      `  #${target}: merge-base hoje é ${base7}, prs.mjs diz ${PRS[target].baseSha} — a base mudou; atualize prs.mjs antes\n`,
    );
    process.exit(2);
  }
  const baseUrl = previewOf(baseSha);
  const headUrl = previewOf(meta.head.sha);
  if (baseUrl === null || headUrl === null) {
    process.stderr.write(`  #${target}: sem preview (base ${baseUrl}, head ${headUrl})\n`);
    continue;
  }
  const files = gh(`repos/${REPO}/pulls/${target}/files?per_page=100`).map((f) => f.filename);
  mkdirSync(join(HERE, "prs"), { recursive: true });
  writeFileSync(
    join(HERE, "prs", `${target}.json`),
    `${JSON.stringify(
      {
        pr: Number(target),
        title: meta.title,
        state: meta.state,
        mergedAt: meta.merged_at,
        headSha: meta.head.sha,
        baseSha,
        basePreview: baseUrl,
        headPreview: headUrl,
        files,
      },
      null,
      2,
    )}\n`,
  );
  const baseDir = join(OUT, `base-${base7}`);
  if (existsSync(join(baseDir, "capture.json"))) {
    process.stdout.write(`  base-${base7} já capturada; reaproveitando\n`);
  } else {
    await capture(baseUrl, baseDir, `base-${base7}`);
  }
  await capture(headUrl, join(OUT, `pr-${target}`), `pr-${target}`);
}
