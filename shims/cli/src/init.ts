import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import { IR_VERSION, parseIr, type IrJourney, type IrStep } from "@aletheia/ir";
import { canonicalPath, discoverRoutes, type DiscoveredRoute } from "@aletheia/runner";
import { EXIT_CODE, type Logger } from "@aletheia/shared";

import type { InitCommandArgs } from "./args.js";

/**
 * `aletheia init` — o kit de onboarding de piloto.
 *
 * A proposta da Fase 1 é "zero configuração". Este comando é o que torna isso
 * literal: dada a URL de produção, descobre as rotas públicas num browser
 * real, escreve a jornada (IR v1, por URL) e o workflow do GitHub Actions que
 * invoca o shim. O piloto revisa a lista de rotas, faz o commit e o próximo PR
 * com preview já recebe o comentário.
 *
 * O que NÃO faz, de propósito: não inventa ações (clique, formulário) — isso é
 * jornada escrita por quem conhece a aplicação; não escolhe rotas "importantes"
 * — mostra as que achou e o humano apaga; não conhece provedor de deploy além
 * do gatilho `deployment_status`, que é o que a Vercel emite e o que o piloto
 * juventude provou. Outro provedor é outro gatilho, editado à mão no YAML.
 *
 * Nenhuma chamada de modelo. Determinístico: a mesma aplicação, na mesma
 * versão, gera o mesmo arquivo.
 */

export interface InitOutcome {
  readonly journeyPath: string;
  readonly workflowPath: string | null;
  readonly routes: readonly DiscoveredRoute[];
  readonly skipped: readonly { readonly href: string; readonly reason: string }[];
  readonly truncated: number;
  readonly visited: number;
}

/** `/` → `home`; `/quem-somos` → `quem-somos`; `/loja/produto` → `loja-produto`. */
export function observationIdOf(path: string): string {
  if (path === "/") return "home";
  const slug = path
    .replace(/^\/+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "home";
}

/** Nome de projeto a partir do host: `www.loja.com.br` → `loja-com-br`. */
export function projectNameOf(url: string): string {
  const host = new URL(url).hostname.replace(/^www\./, "");
  return (
    host
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "app"
  );
}

export function journeyFromRoutes(name: string, routes: readonly string[]): IrJourney {
  const seen = new Set<string>();
  const steps: IrStep[] = [];
  let n = 0;
  for (const raw of routes) {
    const path = canonicalPath(raw);
    let id = observationIdOf(path);
    // Duas rotas com o mesmo slug (`/a-b` e `/a/b`) não podem partilhar o
    // observationId: é a chave de alinhamento entre base e head.
    let suffix = 2;
    while (seen.has(id)) id = `${observationIdOf(path)}-${suffix++}`;
    seen.add(id);
    n += 1;
    steps.push({ id: `st_${String(n).padStart(2, "0")}`, action: "navigate", path });
    n += 1;
    steps.push({
      id: `st_${String(n).padStart(2, "0")}`,
      action: "observe",
      observationId: id,
      masks: [],
      database: [],
    });
  }
  const journey: IrJourney = {
    irVersion: IR_VERSION,
    id: `jr_${name.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
    name,
    viewport: { width: 1280, height: 800 },
    steps,
  };
  // O que o init escreve tem que ser o que o runner aceita — validado aqui,
  // não na primeira execução do piloto.
  return parseIr(journey, "aletheia init");
}

export interface WorkflowInput {
  readonly baseUrl: string;
  readonly journeyPath: string;
  readonly aletheiaRef: string;
  readonly secretHeader: string | null;
}

/**
 * O workflow é o do piloto juventude, parametrizado. Gatilho
 * `deployment_status` (Vercel); compara o preview do PR com a produção; o shim
 * faz o resto. O header secreto, quando declarado, vem de um secret do
 * repositório com o nome da variável — o valor nunca passa por aqui.
 */
export function workflowYaml(input: WorkflowInput): string {
  const envVar = input.secretHeader?.split("=")[1] ?? null;
  const secretLines =
    input.secretHeader === null
      ? ""
      : `          secret-header: ${input.secretHeader}\n` +
        `        env:\n` +
        `          ${envVar}: \${{ secrets.${envVar} }}\n`;
  return (
    `# ALETHEIA — detecção autônoma de regressão em todo PR.\n` +
    `# Gerado por \`aletheia init\`. Gatilho: deploy de preview bem-sucedido\n` +
    `# (evento deployment_status, como a Vercel emite). O shim compara o preview\n` +
    `# do PR com a produção e comenta o resultado no próprio PR.\n` +
    `name: ALETHEIA\n` +
    `on:\n` +
    `  deployment_status:\n` +
    `jobs:\n` +
    `  regressao:\n` +
    `    if: github.event.deployment_status.state == 'success' && github.event.deployment_status.environment != 'Production'\n` +
    `    runs-on: ubuntu-latest\n` +
    `    timeout-minutes: 15\n` +
    `    permissions: { contents: read, pull-requests: write }\n` +
    `    steps:\n` +
    `      - uses: actions/checkout@v4\n` +
    `      - uses: cleberAraujo01/ALETHEIA/shims/github-action@${input.aletheiaRef}\n` +
    `        with:\n` +
    `          aletheia-ref: ${input.aletheiaRef}\n` +
    `          base-url: ${input.baseUrl}\n` +
    `          head-url: \${{ github.event.deployment_status.environment_url }}\n` +
    `          journey: ${input.journeyPath}\n` +
    secretLines
  );
}

export async function initCommand(args: InitCommandArgs, logger: Logger): Promise<number> {
  const name = args.name ?? projectNameOf(args.url);
  const baseUrl = new URL(args.url).origin;

  let routes: readonly DiscoveredRoute[];
  let skipped: readonly { href: string; reason: string }[] = [];
  let truncated = 0;
  let visited = 0;
  if (args.routes !== null) {
    routes = args.routes.map((path, index) => ({
      path: canonicalPath(path),
      depth: index === 0 ? 0 : 1,
      foundOn: null,
    }));
  } else {
    logger.info("descobrindo rotas", {
      url: baseUrl,
      maxRoutes: args.maxRoutes,
      maxDepth: args.maxDepth,
    });
    const result = await discoverRoutes({
      url: baseUrl,
      maxRoutes: args.maxRoutes,
      maxDepth: args.maxDepth,
      deadlineMs: args.deadlineMs,
    });
    routes = result.routes;
    skipped = result.skipped;
    truncated = result.truncated;
    visited = result.visited;
  }

  const journey = journeyFromRoutes(
    name,
    routes.map((route) => route.path),
  );
  await writeText(args.journeyOut, `${JSON.stringify(journey, null, 2)}\n`);

  let workflowPath: string | null = null;
  if (args.workflowOut !== null) {
    await writeText(
      args.workflowOut,
      workflowYaml({
        baseUrl,
        // No YAML o caminho é relativo à raiz do repositório do cliente — é lá
        // que o shim faz o checkout —, nunca o absoluto da máquina de quem rodou.
        journeyPath: relative(process.cwd(), resolve(args.journeyOut)).replace(/\\/g, "/"),
        aletheiaRef: args.aletheiaRef,
        secretHeader: args.secretHeader,
      }),
    );
    workflowPath = args.workflowOut;
  }

  const outcome: InitOutcome = {
    journeyPath: args.journeyOut,
    workflowPath,
    routes,
    skipped,
    truncated,
    visited,
  };
  process.stdout.write(renderInitSummary(outcome, args));
  logger.info("init concluído", {
    routes: routes.length,
    truncated,
    workflow: workflowPath !== null,
  });
  return EXIT_CODE.OK;
}

export function renderInitSummary(outcome: InitOutcome, args: InitCommandArgs): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(
    `  rotas       ${outcome.routes.length}${args.routes === null ? ` (descobertas em ${outcome.visited} página(s))` : " (dadas à mão)"}`,
  );
  for (const route of outcome.routes) {
    lines.push(`    ${observationIdOf(route.path).padEnd(24)} ${route.path}`);
  }
  if (outcome.truncated > 0) {
    lines.push(
      `  +${outcome.truncated} rota(s) além de --max-routes ${args.maxRoutes}; suba o limite ou dê --routes`,
    );
  }
  if (outcome.skipped.length > 0) {
    const porMotivo = new Map<string, number>();
    for (const entry of outcome.skipped)
      porMotivo.set(entry.reason, (porMotivo.get(entry.reason) ?? 0) + 1);
    lines.push(
      `  fora        ${[...porMotivo.entries()].map(([reason, count]) => `${count} ${reason}`).join(" · ")}`,
    );
  }
  lines.push(`  jornada     ${outcome.journeyPath}`);
  if (outcome.workflowPath !== null) lines.push(`  workflow    ${outcome.workflowPath}`);
  lines.push("");
  lines.push("  próximos passos:");
  lines.push("    1. revise a lista acima — apague da jornada o que não deve ser observado");
  lines.push("    2. commit dos dois arquivos na branch default (o gatilho só vale lá)");
  if (args.secretHeader !== null) {
    const envVar = args.secretHeader.split("=")[1] ?? "";
    lines.push(`    3. grave o secret ${envVar} no repositório (Settings → Secrets → Actions)`);
    lines.push("    4. abra um PR: o preview dispara o workflow e o comentário aparece no PR");
  } else {
    lines.push("    3. abra um PR: o preview dispara o workflow e o comentário aparece no PR");
    lines.push(
      "       (preview protegido? gere o bypass no provedor e rode de novo com --secret-header)",
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function writeText(path: string, content: string): Promise<void> {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}
