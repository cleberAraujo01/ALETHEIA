#!/usr/bin/env node
/**
 * Auto-teste do `arch-check` — `pnpm arch:check:selftest`.
 *
 * O repositório hoje não viola nenhum princípio. Isso é bom para o repositório
 * e péssimo para a confiança na ferramenta: um verificador que sempre passa é
 * indistinguível de um verificador quebrado, e a diferença só aparece no dia em
 * que ele deveria ter pego algo e não pegou.
 *
 * Então cada regra é exercitada contra uma árvore de mentira montada aqui: um
 * caso que DEVE falhar e, quando faz sentido, um caso vizinho que NÃO pode
 * falhar. O segundo é tão importante quanto o primeiro — é ele que impede a
 * regra de reprovar quem não errou, que é o defeito que este produto inteiro
 * existe para não cometer.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CHECKER = resolve(dirname(fileURLToPath(import.meta.url)), "arch-check.mjs");

/** Monta uma árvore temporária: `{ "packages/x/src/a.ts": "conteúdo" }`. */
function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "aletheia-arch-"));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return root;
}

function runAgainst(files) {
  const root = tree(files);
  try {
    const result = spawnSync(process.execPath, [CHECKER], {
      env: { ...process.env, ALETHEIA_ARCH_ROOT: root },
      encoding: "utf8",
    });
    return { code: result.status, output: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const manifest = (name) => JSON.stringify({ name, version: "0.0.0" });

let failures = 0;
let passes = 0;

function expectViolation(label, principle, files) {
  const { code, output } = runAgainst(files);
  const ok = code === 1 && output.includes(principle);
  if (ok) passes += 1;
  else {
    failures += 1;
    process.stderr.write(
      `\n  ✗ ${label}\n    esperava falhar citando ${principle}; saiu com ${code}\n${output}\n`,
    );
    return;
  }
  process.stdout.write(`    ✓ pega   ${label}\n`);
}

function expectClean(label, files) {
  const { code, output } = runAgainst(files);
  if (code === 0) {
    passes += 1;
    process.stdout.write(`    ✓ ignora ${label}\n`);
    return;
  }
  failures += 1;
  process.stderr.write(`\n  ✗ ${label}\n    esperava passar; saiu com ${code}\n${output}\n`);
}

process.stdout.write("\n  auto-teste do arch-check\n\n");

// --- PA-01, e o caso que importa é o TRANSITIVO -----------------------------
expectViolation("PA-01: diff-engine importa SDK de modelo direto", "PA-01", {
  "packages/diff-engine/package.json": manifest("@aletheia/diff-engine"),
  "packages/diff-engine/src/index.ts": `import OpenAI from "openai";\nexport const x = OpenAI;\n`,
});

expectViolation("PA-01: diff-engine alcança modelo em TRÊS saltos", "PA-01", {
  "packages/diff-engine/package.json": manifest("@aletheia/diff-engine"),
  "packages/diff-engine/src/index.ts": `import { a } from "@aletheia/shared";\nexport const x = a;\n`,
  "packages/shared/package.json": manifest("@aletheia/shared"),
  "packages/shared/src/index.ts": `import { b } from "@aletheia/oracles";\nexport const a = b;\n`,
  "packages/oracles/package.json": manifest("@aletheia/oracles"),
  "packages/oracles/src/index.ts": `import OpenAI from "openai";\nexport const b = OpenAI;\n`,
});

expectClean("PA-01: control-plane pode falar com modelo", {
  "apps/control-plane/package.json": manifest("@aletheia/control-plane"),
  "apps/control-plane/src/index.ts": `import OpenAI from "openai";\nexport const x = OpenAI;\n`,
});

// --- PA-04 ------------------------------------------------------------------
expectViolation("PA-04: driver de banco fora do executor", "PA-04", {
  "packages/diff-engine/package.json": manifest("@aletheia/diff-engine"),
  "packages/diff-engine/src/index.ts": `import pg from "pg";\nexport const x = pg;\n`,
});

expectClean("PA-04: driver DENTRO do executor de capabilities", {
  "packages/capabilities/package.json": manifest("@aletheia/capabilities"),
  "packages/capabilities/src/executor/run.ts": `import pg from "pg";\nexport const x = pg;\n`,
});

expectViolation("PA-04: SQL com interpolação", "PA-04", {
  "packages/shared/package.json": manifest("@aletheia/shared"),
  "packages/shared/src/index.ts":
    "export const q = (id: string) => `SELECT * FROM orders WHERE id = '${id}'`;\n",
});

expectClean("PA-04: SQL sem interpolação em texto de documentação", {
  "packages/shared/package.json": manifest("@aletheia/shared"),
  "packages/shared/src/index.ts": "// exemplo: SELECT * FROM orders\nexport const q = 1;\n",
});

// --- PA-11 ------------------------------------------------------------------
expectViolation("PA-11: shim acima do orçamento de linhas", "PA-11", {
  "shims/github-action/package.json": manifest("@aletheia/github-action"),
  "shims/github-action/src/main.ts": Array.from(
    { length: 70 },
    (_unused, i) => `export const v${i} = ${i};`,
  ).join("\n"),
});

expectClean("PA-11: shim enxuto passa", {
  "shims/github-action/package.json": manifest("@aletheia/github-action"),
  "shims/github-action/src/main.ts":
    "// comentário não conta\n\nexport const run = () => 1;\nexport const publish = () => 2;\n",
});

expectViolation("PA-11: shim importa oráculo", "PA-11", {
  "shims/gitlab/package.json": manifest("@aletheia/gitlab"),
  "shims/gitlab/src/main.ts": `import { o } from "@aletheia/oracles";\nexport const x = o;\n`,
  "packages/oracles/package.json": manifest("@aletheia/oracles"),
  "packages/oracles/src/index.ts": "export const o = 1;\n",
});

// --- PA-12 ------------------------------------------------------------------
expectViolation("PA-12: campo opcional em RunMetadata", "PA-12", {
  "packages/shared/package.json": manifest("@aletheia/shared"),
  "packages/shared/src/metadata.ts":
    "export interface RunMetadata {\n  readonly runId: string;\n  readonly seed?: string;\n}\n",
});

expectClean("PA-12: RunMetadata com campo anulável mas obrigatório", {
  "packages/shared/package.json": manifest("@aletheia/shared"),
  "packages/shared/src/metadata.ts":
    "export interface RunMetadata {\n  readonly runId: string;\n  readonly seed: string | null;\n}\n",
});

// --- ADR-012 ----------------------------------------------------------------
expectViolation("ADR-012: relógio lido fora da abstração", "ADR-012", {
  "packages/diff-engine/package.json": manifest("@aletheia/diff-engine"),
  "packages/diff-engine/src/index.ts": "export const t = Date.now();\n",
});

expectClean("ADR-012: relógio lido dentro do Clock", {
  "packages/shared/package.json": manifest("@aletheia/shared"),
  "packages/shared/src/metadata.ts":
    "export const systemClock = { nowUtcIso: () => new Date().toISOString() };\n",
});

process.stdout.write(`\n  ${passes} passou(ram), ${failures} falhou(ram)\n\n`);
process.exit(failures === 0 ? 0 : 1);
