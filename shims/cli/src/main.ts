#!/usr/bin/env node
import {
  EXIT_CODE,
  PlatformError,
  createLogger,
  isPlatformError,
  newRunId,
  type Logger,
} from "@aletheia/shared";

import {
  parseCaptureArgs,
  parseDiffArgs,
  parseMeasureArgs,
  parseRunArgs,
  parseSuppressProposeArgs,
  parseSuppressSimulateArgs,
  type CaptureCommandArgs,
  type DiffCommandArgs,
} from "./args.js";
import { measureCommand } from "./measure.js";
import { performCapture, performDiff, renderConsoleSummary } from "./ops.js";
import { runCommand } from "./run.js";
import { suppressProposeCommand, suppressSimulateCommand } from "./suppress.js";

const USAGE = `
aletheia — plataforma de engenharia de qualidade autônoma

  aletheia run     --base-url <url> --head-url <url> --journey <jornada.json> [opções]
  aletheia capture --url <baseUrl> --journey <jornada.json> [opções]
  aletheia diff    --base <captura.json> --head <captura.json> [opções]
  aletheia measure --report <report.json> --labels <rotulos.json>
  aletheia suppress propose  --report <report.json> --labels <rotulos.json> --rules <arquivo> --labeled-by <quem>
  aletheia suppress simulate --report <report.json> --rules <arquivo> [--labels <rotulos.json>]

\`run\` é o contrato com os shims de CI: captura base e head, difere, e deixa
prontos report.json, report.html, comment.md (comentário de PR) e summary.json.
\`capture\` observa uma build e produz um artefato de captura.
\`diff\` compara duas capturas (oráculo O5) e emite veredito determinístico.
\`measure\` confronta o relatório com rotulagem humana e mede precisão e recall.
\`suppress\` fecha o laço de RN-ORC-010: rótulos NOISE viram regras PROPOSED por
projeto, e a simulação diz o que elas fariam antes de alguém ativá-las.

Opções de run:
  --base-url <url>        Build de referência                     (obrigatório)
  --head-url <url>        Build candidata                         (obrigatório)
  --journey <arquivo>     Jornada: rotas a visitar               (obrigatório)
  --out <diretório>       Destino de capturas e relatórios       (default: .aletheia/run)
  --commit <sha>          Commit da build head
  --base-ref <ref>        Referência da build base
  --env <nome>            Nome do ambiente observado
  --confidence-mode <m>   ISOLATED | PARTITIONED | SHARED_DEGRADED (default: SHARED_DEGRADED)
  --seed <valor>          Semente determinística
  --suppressions <arq>    Regras de supressão aprendidas do projeto; só ACTIVE valem
  --screenshots false     Não capturar imagem (a camada visual vira lacuna declarada)
  --deadline <ms>         Deadline de convergência               (default: 15000)
  --fail-on none          Não altera o código de saída em caso de regressão
  --elements <arquivo>    Repositório de elementos para alvos { ref } na jornada
  --base-db <url>         Banco da build base (sqlite:<arquivo>) — só com --capabilities
  --head-db <url>         Banco da build head (sqlite:<arquivo>)
  --capabilities <dir>    Catálogo de capabilities YAML (§14.3); só READ APPROVED executa
  --db-env <ambiente>     ephemeral | isolated | staging | production (default: staging)
  --data-strategy <s>     template-clone | shared-degraded (default com banco: shared-degraded)
  --secret-header <h=V>   Header enviado em toda requisição das duas capturas, com valor lido
                          da variável de ambiente V (ex.: x-vercel-protection-bypass=VERCEL_
                          AUTOMATION_BYPASS_SECRET). O valor é segredo: mascarado em captura,
                          trace e relatório, nunca em argv ou log. Vários: separe por vírgula.

Opções de capture:
  --url <baseUrl>         URL base da build a observar           (obrigatório)
  --journey <arquivo>     Jornada: rotas a visitar               (obrigatório)
  --out <diretório>       Destino da captura e screenshots       (default: .aletheia/capture)
  --label <nome>          Rótulo da build: base, head…           (default: unlabeled)
  --commit <sha>          Commit observado
  --seed <valor>          Semente determinística (semeia Math.random na página)
  --screenshots false     Não capturar imagem
  --headed                Abre o browser visível, para acompanhar a navegação
  --deadline <ms>         Deadline de convergência               (default: 15000)
  --elements <arquivo>    Repositório de elementos para alvos { ref } na jornada
  --db <url>              Banco desta build (sqlite:<arquivo> | postgres://…) — só com --capabilities
  --capabilities <dir>    Catálogo de capabilities YAML (§14.3)
  --db-env <ambiente>     ephemeral | isolated | staging | production (default: staging)
  --data-strategy <s>     template-clone: --db é TEMPLATE, a execução roda num clone descartado no fim
  --secret-header <h=V>   Header secreto por variável de ambiente — igual ao de run

Opções de diff:
  --base <arquivo>        Captura da build de referência         (obrigatório)
  --head <arquivo>        Captura da build candidata             (obrigatório)
  --out <diretório>       Destino dos relatórios                 (default: .aletheia)
  --format json,html      Formatos a emitir                      (default: json,html)
  --visual false          Não comparar screenshots
  --commit <sha>          Commit da build head
  --base-ref <ref>        Referência da build base
  --env <nome>            Nome do ambiente observado
  --confidence-mode <m>   ISOLATED | PARTITIONED | SHARED_DEGRADED
  --seed <valor>          Seed registrado no relatório
  --fail-on none          Não altera o código de saída em caso de regressão
  --suppressions <arq>    Regras de supressão aprendidas do projeto; só ACTIVE valem

Opções de measure:
  --report <arquivo>      report.json produzido por \`diff\`      (obrigatório)
  --labels <arquivo>      Rótulos humanos por deltaId
  --emit-labels <arquivo> Gera esqueleto de rotulagem para preencher

Opções de suppress propose:
  --report <arquivo>      report.json produzido por \`diff\`      (obrigatório)
  --labels <arquivo>      Rótulos humanos por deltaId              (obrigatório)
  --rules <arquivo>       Arquivo de regras do projeto; criado se não existir
  --project <id>          Identificador do projeto (obrigatório ao criar o arquivo)
  --labeled-by <quem>     Quem rotulou — vira evidência              (obrigatório)

Opções de suppress simulate:
  --report <arquivo>      report.json produzido por \`diff\`      (obrigatório)
  --rules <arquivo>       Arquivo de regras do projeto              (obrigatório)
  --labels <arquivo>      Rótulos humanos; sem eles o custo é desconhecido, não zero

Códigos de saída:
  0  nenhuma regressão
  1  regressão detectada — falha real do código sob teste
  2  falha da plataforma — o shim de CI NÃO deve reprovar o PR (RN-CI-005)
`;

async function main(argv: readonly string[]): Promise<number> {
  const command = argv[0];

  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(`${USAGE}\n`);
    return EXIT_CODE.OK;
  }

  const runId = newRunId();
  const logger = createLogger({ context: { runId, orgId: null, projectId: null } });

  if (command === "run") {
    return runCommand(parseRunArgs(argv.slice(1)), runId, logger);
  }
  if (command === "capture") {
    return captureCommand(parseCaptureArgs(argv.slice(1)), runId, logger);
  }
  if (command === "diff") {
    return diffCommand(parseDiffArgs(argv.slice(1)), runId, logger);
  }
  if (command === "measure") {
    return measureCommand(parseMeasureArgs(argv.slice(1)));
  }
  if (command === "suppress") {
    const sub = argv[1];
    if (sub === "propose") return suppressProposeCommand(parseSuppressProposeArgs(argv.slice(2)));
    if (sub === "simulate")
      return suppressSimulateCommand(parseSuppressSimulateArgs(argv.slice(2)));
    throw new PlatformError("CAPTURE_INVALID", {
      reason: `subcomando de suppress desconhecido: ${String(sub)} (propose | simulate)`,
    });
  }

  throw new PlatformError("CAPTURE_INVALID", { reason: `comando desconhecido: ${command}` });
}

async function captureCommand(
  args: CaptureCommandArgs,
  runId: string,
  logger: Logger,
): Promise<number> {
  const result = await performCapture(args, logger, runId);
  process.stdout.write(
    `\n  captura     ${result.capture.captureId}\n` +
      `  execução    ${runId}\n` +
      `  browser     ${result.browserVersion}\n` +
      `  observações ${result.capture.observations.length}` +
      (result.capture.interruption === null
        ? ""
        : `  ·  JORNADA INTERROMPIDA no passo ${result.capture.interruption.stepId}: ${result.capture.interruption.reason}`) +
      (result.trace.healings.length === 0
        ? ""
        : `\n  curas       ${result.trace.healings.length} PROPOSTA(S) — nenhuma aplicada; veja healing.json`) +
      `\n  artefatos   ${result.captureFilePath}  ${result.traceFilePath}\n\n`,
  );
  return EXIT_CODE.OK;
}

async function diffCommand(args: DiffCommandArgs, runId: string, logger: Logger): Promise<number> {
  const { report, reportPaths } = await performDiff(args, runId, logger);
  process.stdout.write(renderConsoleSummary(report, reportPaths));
  if (report.verdict.blocking && args.failOnRegression) {
    return EXIT_CODE.QUALITY_GATE_FAILED;
  }
  return EXIT_CODE.OK;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (isPlatformError(error)) {
    // RN-CI-005: falha nossa. Sai com 2 para que o shim reporte como neutro.
    process.stderr.write(
      `\n  falha de plataforma: ${error.code}\n${Object.entries(error.context)
        .map(([key, value]) => `    ${key}: ${String(value)}`)
        .join("\n")}\n\n`,
    );
    process.exitCode = EXIT_CODE.PLATFORM_FAILURE;
  } else {
    // Erro não previsto também é falha nossa — jamais reprovação do cliente.
    process.stderr.write(`\n  falha de plataforma não classificada: ${String(error)}\n\n`);
    process.exitCode = EXIT_CODE.PLATFORM_FAILURE;
  }
}
