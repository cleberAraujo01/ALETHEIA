#!/usr/bin/env node
/**
 * Verificação de arquitetura — `pnpm arch:check`.
 *
 * POR QUE ISTO EXISTE. Os princípios de CLAUDE.md §2 têm força de lei, e lei
 * sem fiscal é texto. ESLint verifica arquivo por arquivo; a maior parte do que
 * importa aqui é RELAÇÃO ENTRE PACOTES — e a violação real nunca é um import
 * direto e óbvio, é o terceiro salto de uma cadeia que ninguém percorreu.
 *
 * A régua para uma regra entrar aqui é a mesma que aplicamos ao produto: pega
 * uma classe de defeito que nenhuma outra ferramenta pega, e não reprova quem
 * não errou. Cada mensagem de erro cita o princípio E explica o motivo — um
 * gate que só diz "violou a regra 4" ensina a contornar, não a entender.
 *
 * ALGUMAS REGRAS SÃO TRIPWIRE. Vários pacotes citados em CLAUDE.md §4 ainda não
 * existem (`model-gateway`, `capabilities`, `invariants`, `ir`). As regras que
 * os mencionam não podem falhar hoje, e é assim mesmo: elas falham no dia em
 * que o pacote nascer com a dependência errada, que é exatamente quando o custo
 * de corrigir ainda é zero. Estão marcadas com `tripwire: true` e aparecem no
 * resumo, para ninguém confundir "não falhou" com "foi verificado".
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// `ALETHEIA_ARCH_ROOT` aponta o verificador para outra árvore. Existe para o
// auto-teste (`arch-check.selftest.mjs`) poder montar violações de mentira e
// provar que cada regra REALMENTE falha — regra que nunca disparou é
// indistinguível de regra quebrada, e este repositório não tem como saber a
// diferença de outro jeito, porque hoje ele não viola nenhuma.
const ROOT = resolve(
  process.env["ALETHEIA_ARCH_ROOT"] ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."),
);
const WORKSPACE_GLOBS = ["packages", "apps", "shims"];

// ---------------------------------------------------------------------------
// Coleta
// ---------------------------------------------------------------------------

/** @returns {string[]} caminhos de arquivo, relativos à raiz, com `/`. */
function collectSources() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "dist" || entry === ".turbo") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.(ts|mts|cts|mjs|js)$/.test(entry)) {
        out.push(relative(ROOT, full).split(sep).join("/"));
      }
    }
  };
  for (const area of WORKSPACE_GLOBS) {
    const dir = join(ROOT, area);
    try {
      walk(dir);
    } catch {
      /* área ainda não existe */
    }
  }
  return out;
}

/** Nome do pacote de workspace dono de um arquivo (`packages/diff-engine` → `diff-engine`). */
function ownerOf(file) {
  const [area, name] = file.split("/");
  return area !== undefined && name !== undefined && WORKSPACE_GLOBS.includes(area)
    ? `${area}/${name}`
    : null;
}

const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\)/g;

/** Especificadores importados por um arquivo. */
function importsOf(source) {
  const found = new Set();
  for (const match of source.matchAll(IMPORT_RE)) {
    const spec = match[1] ?? match[2] ?? match[3];
    if (spec !== undefined) found.add(spec);
  }
  return found;
}

const files = collectSources();
/** @type {Map<string, string>} arquivo → conteúdo */
const sources = new Map(files.map((file) => [file, readFileSync(join(ROOT, file), "utf8")]));

/** Mapa `@aletheia/x` → `packages/x`, lido dos package.json reais. */
const packageNameToDir = new Map();
for (const area of WORKSPACE_GLOBS) {
  let entries;
  try {
    entries = readdirSync(join(ROOT, area));
  } catch {
    continue;
  }
  for (const name of entries) {
    try {
      const manifest = JSON.parse(readFileSync(join(ROOT, area, name, "package.json"), "utf8"));
      packageNameToDir.set(manifest.name, `${area}/${name}`);
    } catch {
      /* sem package.json */
    }
  }
}

/** Grafo pacote → pacotes e dependências externas que ele importa. */
const graph = new Map();
for (const [file, source] of sources) {
  const owner = ownerOf(file);
  if (owner === null) continue;
  const edges = graph.get(owner) ?? new Set();
  for (const spec of importsOf(source)) {
    if (spec.startsWith(".") || spec.startsWith("node:")) continue;
    edges.add(packageNameToDir.get(spec) ?? externalRootOf(spec));
  }
  graph.set(owner, edges);
}

/** `@scope/pkg/sub` → `@scope/pkg`; `pkg/sub` → `pkg`. */
function externalRootOf(spec) {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? spec);
}

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------

const violations = [];
const checked = [];

function report(principle, message, detail) {
  violations.push({ principle, message, detail });
}

function record(id, principle, tripwire, note) {
  checked.push({ id, principle, tripwire, note });
}

// ---------------------------------------------------------------------------
// PA-01 — LLM propõe, determinístico dispõe
//
// A regra mais importante do repositório. O caminho de gate não pode alcançar um
// modelo NEM DE LONGE: transitividade é o ponto, porque uma importação em três
// saltos viola PA-01 igual a uma direta e é assim que a violação realmente
// acontece — ninguém escreve `import { openai }` dentro do diff-engine.
// ---------------------------------------------------------------------------

const GATE_PATH = [
  "packages/diff-engine",
  "packages/selector-engine",
  "packages/invariants",
  "packages/ir",
  "packages/capabilities",
  "apps/runner",
];

const MODEL_SOURCES = new Set([
  "packages/model-gateway",
  "@aletheia/model-gateway",
  "openai",
  "@anthropic-ai/sdk",
  "@google/generative-ai",
  "@google/genai",
  "cohere-ai",
  "@mistralai/mistralai",
  "ollama",
  "langchain",
  "@langchain/core",
  "ai",
]);

/** Caminho de importação de `from` até qualquer origem de modelo, ou null. */
function pathToModel(from) {
  const queue = [[from, [from]]];
  const seen = new Set([from]);
  while (queue.length > 0) {
    const [current, trail] = queue.shift();
    for (const next of graph.get(current) ?? []) {
      if (MODEL_SOURCES.has(next)) return [...trail, next];
      if (seen.has(next) || !graph.has(next)) continue;
      seen.add(next);
      queue.push([next, [...trail, next]]);
    }
  }
  return null;
}

for (const pkg of GATE_PATH) {
  if (!graph.has(pkg)) continue;
  const trail = pathToModel(pkg);
  if (trail !== null) {
    report(
      "PA-01",
      `${pkg} alcança um modelo de linguagem.`,
      `Caminho: ${trail.join(" → ")}\n` +
        "  Este código roda dentro do orçamento de 5 minutos do Tier 1 e o resultado\n" +
        "  influencia o veredito. Chamada de modelo aqui torna o gate não-determinístico:\n" +
        "  a mesma entrada passa a poder produzir vereditos diferentes, e PA-12 (todo\n" +
        "  veredito é reproduzível) deixa de valer. O LLM propõe FORA do gate; aqui\n" +
        "  dentro, só código determinístico dispõe.",
    );
  }
}
record(
  "PA-01/fronteira-de-modelo",
  "PA-01",
  !GATE_PATH.some(
    (pkg) => graph.has(pkg) && pkg !== "packages/diff-engine" && pkg !== "apps/runner",
  ),
  `${GATE_PATH.filter((p) => graph.has(p)).length} de ${GATE_PATH.length} pacotes do caminho de gate existem hoje`,
);

// ---------------------------------------------------------------------------
// PA-04 — a IA nunca recebe uma conexão
// ---------------------------------------------------------------------------

const DB_DRIVERS = new Set([
  "pg",
  "postgres",
  "mysql",
  "mysql2",
  "mssql",
  "tedious",
  "oracledb",
  "mongodb",
  "ioredis",
  "redis",
  "better-sqlite3",
  "sqlite3",
  "knex",
  "typeorm",
  "prisma",
  "@prisma/client",
  "drizzle-orm",
]);

const EXECUTOR_DIR = "packages/capabilities/src/executor/";

for (const [file, source] of sources) {
  for (const spec of importsOf(source)) {
    const root = externalRootOf(spec);
    if (!DB_DRIVERS.has(root)) continue;
    if (file.startsWith(EXECUTOR_DIR)) continue;
    report(
      "PA-04",
      `${file} importa o driver de banco '${root}'.`,
      `Driver de banco só pode ser importado por ${EXECUTOR_DIR}.\n` +
        "  Fora dali, alguém acaba com uma conexão na mão e a próxima linha é uma\n" +
        "  query montada em string. O caminho é capability compilada: allowlist de\n" +
        "  tabela e coluna, sensibilidade declarada, EXPLAIN verificado, execução\n" +
        "  parametrizada (ARQUITETURA.md §14.3).",
    );
  }
}
record(
  "PA-04/driver-de-banco",
  "PA-04",
  !files.some((f) => f.startsWith("packages/capabilities/")),
  "nenhum driver de banco no repositório hoje",
);

// SQL montado dinamicamente. O ESLint não alcança este caso porque a montagem
// costuma atravessar variáveis e concatenações; aqui basta o texto.
const SQL_INTERPOLATED =
  /`[^`]*\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|DROP\s+TABLE)\b[^`]*\$\{/is;

for (const [file, source] of sources) {
  if (file.startsWith("scripts/")) continue;
  const match = SQL_INTERPOLATED.exec(source);
  if (match !== null) {
    report(
      "PA-04",
      `${file} monta SQL com interpolação.`,
      `Trecho: ${match[0].slice(0, 80).replace(/\s+/g, " ")}…\n` +
        "  SQL concatenado é RN-DAT-002 violada, e o modo de falhar não é injeção\n" +
        "  clássica: é o UPDATE sem o WHERE correto na milésima execução, que deixa\n" +
        "  o banco num estado válido-porém-inconsistente que ninguém detecta.\n" +
        "  Use capability parametrizada.",
    );
  }
}
record("PA-04/sql-interpolado", "PA-04", false, "verificado em todos os fontes");

// ---------------------------------------------------------------------------
// PA-11 — um runner, muitos shims
//
// `shims/cli` está FORA do orçamento de 60 linhas, e a exceção é declarada, não
// silenciosa: CLAUDE.md §4 chama a CLI de "fonte da verdade" e §6.2 aplica o
// orçamento a shim de PROVEDOR DE CI (github-action, gitlab-template…), cujo
// trabalho é autenticar, invocar e publicar. A CLI é o produto.
// ---------------------------------------------------------------------------

const SHIM_LINE_BUDGET = 60;
const SHIM_EXEMPT = new Set(["shims/cli"]);
const SHIM_FORBIDDEN = new Set([
  "packages/world-model",
  "packages/oracles",
  "packages/invariants",
  "@aletheia/world-model",
  "@aletheia/oracles",
  "@aletheia/invariants",
]);

/** Linhas efetivas: sem comentário, sem import, sem linha vazia. */
function effectiveLines(source) {
  let inBlock = false;
  let count = 0;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (inBlock) {
      if (line.includes("*/")) inBlock = false;
      continue;
    }
    if (line.startsWith("/*")) {
      if (!line.includes("*/")) inBlock = true;
      continue;
    }
    if (line === "" || line.startsWith("//") || line.startsWith("*")) continue;
    if (/^(import|export)\b.*from\s*["']/.test(line)) continue;
    count += 1;
  }
  return count;
}

const shimDirs = new Set(
  files.map(ownerOf).filter((owner) => owner !== null && owner.startsWith("shims/")),
);

for (const shim of shimDirs) {
  if (SHIM_EXEMPT.has(shim)) continue;

  const shimFiles = files.filter((file) => ownerOf(file) === shim && !/\.test\.ts$/.test(file));
  const total = shimFiles.reduce((sum, file) => sum + effectiveLines(sources.get(file) ?? ""), 0);
  if (total > SHIM_LINE_BUDGET) {
    report(
      "PA-11",
      `${shim} tem ${total} linhas efetivas (orçamento: ${SHIM_LINE_BUDGET}).`,
      "Um shim faz exatamente três coisas: autenticar, invocar `aletheia run`,\n" +
        "  publicar o resultado no formato nativo do provedor. Se ele cresceu, é\n" +
        "  porque uma decisão migrou para dentro dele — e decisão duplicada em seis\n" +
        "  provedores diverge em seis direções. Essa decisão pertence ao control plane.",
    );
  }

  for (const file of shimFiles) {
    for (const spec of importsOf(sources.get(file) ?? "")) {
      const root = packageNameToDir.get(spec) ?? externalRootOf(spec);
      if (SHIM_FORBIDDEN.has(root) || SHIM_FORBIDDEN.has(spec)) {
        report(
          "PA-11",
          `${file} importa '${spec}'.`,
          "Shim não conhece World Model, oráculo nem invariante. Ele invoca o\n" +
            "  runner e publica o que voltou. Conhecer essas peças é ter opinião sobre\n" +
            "  o veredito, e isso é do control plane.",
        );
      }
    }
  }
}
record(
  "PA-11/orcamento-de-shim",
  "PA-11",
  shimDirs.size === SHIM_EXEMPT.size,
  `${shimDirs.size} shim(s); ${[...SHIM_EXEMPT].join(", ")} isento por ser a CLI (§4)`,
);

// ---------------------------------------------------------------------------
// PA-12 — todo veredito é reproduzível
//
// A garantia principal é do COMPILADOR, não daqui: `DiffOptions.metadata` e
// `DiffReport.metadata` são obrigatórios, então não existe caminho de código que
// produza veredito sem metadados. O que esta regra protege é essa propriedade —
// o dia em que um campo de `RunMetadata` virar opcional, a garantia evapora em
// silêncio e nada mais avisa.
// ---------------------------------------------------------------------------

// A interface é procurada em TODA a árvore, não num caminho fixo: se ela mudar
// de arquivo, a regra continua valendo em vez de reprovar por não achar. E se
// não existir em lugar nenhum, não há garantia a proteger — vira tripwire, não
// violação. Reprovar uma árvore que simplesmente ainda não tem `RunMetadata`
// seria o exato defeito que este verificador existe para não cometer.
let metadataFound = null;
for (const [file, source] of sources) {
  const block = /export interface RunMetadata\s*\{([\s\S]*?)\n\}/.exec(source);
  if (block !== null) {
    metadataFound = { file, body: block[1] ?? "" };
    break;
  }
}

if (metadataFound !== null) {
  const optionals = [...metadataFound.body.matchAll(/^\s*(?:readonly\s+)?(\w+)\?\s*:/gm)].map(
    (match) => match[1],
  );
  if (optionals.length > 0) {
    report(
      "PA-12",
      `RunMetadata (${metadataFound.file}) tem campo(s) opcional(is): ${optionals.join(", ")}.`,
      "Metadado opcional é metadado ausente na hora errada. Sem `runId`, `seed`,\n" +
        "  `commit` e versões, o veredito não reconstitui a execução e deixa de ser\n" +
        "  auditável — RN-EXE-001. Campo que pode não existir declara-se `| null`,\n" +
        "  obrigando quem constrói a decidir explicitamente.",
    );
  }
}
record(
  "PA-12/metadados-obrigatorios",
  "PA-12",
  metadataFound === null,
  metadataFound === null
    ? "RunMetadata não existe nesta árvore"
    : `garantido pelo tipo em ${metadataFound.file}; esta regra protege a garantia`,
);

// ---------------------------------------------------------------------------
// Determinismo de relógio
//
// O `Clock` injetável já existe (`packages/shared/src/metadata.ts`). Ler o
// relógio direto em qualquer outro lugar reintroduz não-determinismo no ponto
// exato onde ADR-012 o eliminou.
// ---------------------------------------------------------------------------

const CLOCK_ALLOWED = new Set([
  // A única implementação de `Clock` — é ela que encapsula a leitura.
  "packages/shared/src/metadata.ts",
  // Carimbo de linha de log. Não entra em veredito nem em artefato comparado.
  "packages/shared/src/logger.ts",
]);
const WALL_CLOCK = /\bDate\.now\(\)|new Date\(\s*\)/;

for (const [file, source] of sources) {
  if (CLOCK_ALLOWED.has(file) || /\.test\.ts$/.test(file) || file.startsWith("scripts/")) continue;
  if (WALL_CLOCK.test(source)) {
    report(
      "ADR-012",
      `${file} lê o relógio do sistema diretamente.`,
      "Receba um `Clock` (packages/shared) em vez de chamar `Date.now()`/`new Date()`.\n" +
        "  Duas execuções do mesmo par de capturas precisam produzir o mesmo conjunto\n" +
        "  de deltas; relógio lido no meio do caminho quebra isso de um jeito que só\n" +
        "  aparece como flake intermitente meses depois.",
    );
  }
}
record(
  "ADR-012/relogio-injetavel",
  "ADR-012",
  false,
  `${CLOCK_ALLOWED.size} arquivo(s) autorizado(s)`,
);

// ---------------------------------------------------------------------------
// Saída
// ---------------------------------------------------------------------------

const tripwires = checked.filter((check) => check.tripwire);

process.stdout.write(`\n  arch-check — ${checked.length} regra(s), ${files.length} arquivo(s)\n\n`);
for (const check of checked) {
  const mark = check.tripwire ? "○" : "●";
  process.stdout.write(
    `    ${mark} ${check.principle.padEnd(8)} ${check.id.padEnd(34)} ${check.note}\n`,
  );
}
if (tripwires.length > 0) {
  process.stdout.write(
    `\n  ○ = TRIPWIRE: o alvo ainda não existe no repositório, então a regra não pode\n` +
      `    falhar hoje. Ela existe para falhar no dia em que o pacote nascer errado.\n` +
      `    Não confunda com "verificado".\n`,
  );
}

if (violations.length === 0) {
  process.stdout.write(`\n  nenhuma violação\n\n`);
  process.exit(0);
}

process.stderr.write(`\n  ${violations.length} VIOLAÇÃO(ÕES) DE ARQUITETURA\n`);
for (const violation of violations) {
  process.stderr.write(
    `\n  ${violation.principle} — ${violation.message}\n  ${violation.detail}\n`,
  );
}
process.stderr.write(
  `\n  Um PR que viole princípio arquitetural não é aprovado: ou o PR muda, ou vem\n` +
    `  acompanhado de ADR em docs/adr/ com as consequências negativas declaradas\n` +
    `  (CLAUDE.md §2 e §11).\n\n`,
);
process.exit(1);
