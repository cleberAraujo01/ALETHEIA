import { PlatformError, type ConfidenceMode, type DataStrategy } from "@aletheia/shared";

/**
 * Parser de argumentos sem dependência externa.
 *
 * A CLI é a fonte da verdade dos shims (§15.1): todo outro provedor de CI vai
 * apenas invocar este contrato. Manter o contrato explícito e sem mágica é o
 * que permite que um shim tenha menos de 60 linhas (§6.2).
 */

export interface DiffCommandArgs {
  readonly base: string;
  readonly head: string;
  readonly out: string;
  readonly formats: readonly ("json" | "html")[];
  readonly commit: string | null;
  readonly baseRef: string | null;
  readonly environment: string;
  readonly confidenceMode: ConfidenceMode;
  readonly seed: string;
  /** Quando `false`, regressão não altera o código de saída. Útil em rodagem exploratória. */
  readonly failOnRegression: boolean;
  /** Quando `false`, a camada visual vira lacuna declarada em vez de rodar. */
  readonly visual: boolean;
  /**
   * Arquivo de supressão aprendida do projeto. Só regras `ACTIVE` valem, e o
   * motor recusa `ACTIVE` sem evidência — não há flag para forçar.
   */
  readonly suppressions: string | null;
  /** §15.2 — como o dado foi isolado nesta execução; vai para os metadados (PA-12). */
  readonly dataStrategy: DataStrategy | null;
}

/**
 * `aletheia run` — a invocação que o shim de CI faz (§15.2). É composição
 * estrita de `capture` + `capture` + `diff`, com os mesmos defaults; o que
 * muda é só o que precisa mudar quando ninguém está olhando o terminal.
 */
export interface RunCommandArgs {
  readonly baseUrl: string;
  readonly headUrl: string;
  readonly journey: string;
  readonly out: string;
  readonly commit: string | null;
  readonly baseRef: string | null;
  readonly environment: string;
  /**
   * Default `SHARED_DEGRADED`, o oposto do `diff` avulso. `run` roda contra
   * duas URLs vivas que a CLI não tem como saber se compartilham banco ou
   * sessão; declarar o pior caso é RN-EXE-007, e quem sabe mais passa a flag.
   */
  readonly confidenceMode: ConfidenceMode;
  readonly seed: string;
  readonly suppressions: string | null;
  readonly screenshots: boolean;
  readonly deadlineMs: number;
  readonly failOnRegression: boolean;
  readonly elements: string | null;
  readonly baseDb: string | null;
  readonly headDb: string | null;
  readonly capabilities: string | null;
  readonly dbEnvironment: DbEnvironment;
  readonly dataStrategy: DataStrategy | null;
}

export function parseRunArgs(argv: readonly string[]): RunCommandArgs {
  const flags = toFlagMap(argv);
  const deadline = Number(flags.get("deadline") ?? "15000");
  if (!Number.isFinite(deadline) || deadline <= 0) {
    throw new PlatformError("CAPTURE_INVALID", {
      reason: `--deadline precisa ser um número positivo de milissegundos: ${String(flags.get("deadline"))}`,
    });
  }
  const confidenceMode = (flags.get("confidence-mode") ?? "SHARED_DEGRADED") as ConfidenceMode;
  if (!CONFIDENCE_MODES.includes(confidenceMode)) {
    throw new PlatformError("CAPTURE_INVALID", {
      reason: `modo de confiança desconhecido: ${confidenceMode}`,
      supported: CONFIDENCE_MODES.join(", "),
    });
  }
  return {
    baseUrl: required(flags, "base-url"),
    headUrl: required(flags, "head-url"),
    journey: required(flags, "journey"),
    out: flags.get("out") ?? ".aletheia/run",
    // Vazio conta como ausente: um shim que interpola `${{ ... || '' }}` manda
    // a flag com string vazia, e "" não é um commit.
    commit: optional(flags, "commit"),
    baseRef: optional(flags, "base-ref"),
    environment: flags.get("env") ?? "unknown",
    confidenceMode,
    seed: flags.get("seed") ?? "0",
    suppressions: optional(flags, "suppressions"),
    screenshots: flags.get("screenshots") !== "false",
    deadlineMs: deadline,
    failOnRegression: flags.get("fail-on") !== "none",
    elements: optional(flags, "elements"),
    baseDb: optional(flags, "base-db"),
    headDb: optional(flags, "head-db"),
    capabilities: optional(flags, "capabilities"),
    dbEnvironment: dbEnvironmentOf(flags),
    dataStrategy: dataStrategyOf(
      flags,
      optional(flags, "base-db") === null && optional(flags, "head-db") === null
        ? null
        : "shared-degraded",
    ),
  };
}

export interface SuppressProposeArgs {
  readonly report: string;
  readonly labels: string;
  /** Arquivo de regras: lido se existir, reescrito com as propostas. */
  readonly rules: string;
  /** Obrigatório se o arquivo ainda não existe. */
  readonly project: string | null;
  /** Quem rotulou. Evidência anônima não é evidência. */
  readonly labeledBy: string;
}

export interface SuppressSimulateArgs {
  readonly report: string;
  readonly rules: string;
  readonly labels: string | null;
}

export function parseSuppressProposeArgs(argv: readonly string[]): SuppressProposeArgs {
  const flags = toFlagMap(argv);
  return {
    report: required(flags, "report"),
    labels: required(flags, "labels"),
    rules: required(flags, "rules"),
    project: flags.get("project") ?? null,
    labeledBy: required(flags, "labeled-by"),
  };
}

export function parseSuppressSimulateArgs(argv: readonly string[]): SuppressSimulateArgs {
  const flags = toFlagMap(argv);
  return {
    report: required(flags, "report"),
    rules: required(flags, "rules"),
    labels: flags.get("labels") ?? null,
  };
}

export interface CaptureCommandArgs {
  readonly url: string;
  readonly journey: string;
  readonly out: string;
  readonly label: string;
  readonly commit: string | null;
  readonly seed: string;
  readonly screenshots: boolean;
  readonly headed: boolean;
  readonly deadlineMs: number;
  /** Repositório de elementos (§12.3) para alvos `{ ref }`. */
  readonly elements: string | null;
  /** URL de conexão do banco desta build (`sqlite:<arquivo>`). Nunca logada. */
  readonly db: string | null;
  /** Diretório ou arquivo de capabilities YAML (§14.3). */
  readonly capabilities: string | null;
  /** Ambiente para `allowedEnvironments` das capabilities. */
  readonly dbEnvironment: DbEnvironment;
  /**
   * `template-clone`: o banco de `--db` é TEMPLATE; a execução roda num clone
   * descartado no fim (RN-DAT-013). `shared-degraded` (default com `--db`):
   * aponta para o banco como está, e o relatório diz.
   */
  readonly dataStrategy: DataStrategy | null;
}

const DATA_STRATEGIES: readonly DataStrategy[] = [
  "template-clone",
  "ephemeral-container",
  "partition",
  "shared-degraded",
];

function dataStrategyOf(
  flags: Map<string, string>,
  fallback: DataStrategy | null,
): DataStrategy | null {
  const value = flags.get("data-strategy");
  if (value === undefined || value.length === 0) return fallback;
  if (!DATA_STRATEGIES.includes(value as DataStrategy)) {
    throw new PlatformError("CAPTURE_INVALID", {
      reason: `--data-strategy desconhecida: ${value}`,
      supported: DATA_STRATEGIES.join(", "),
    });
  }
  return value as DataStrategy;
}

export type DbEnvironment = "ephemeral" | "isolated" | "staging" | "production";
const DB_ENVIRONMENTS: readonly DbEnvironment[] = [
  "ephemeral",
  "isolated",
  "staging",
  "production",
];

function dbEnvironmentOf(flags: Map<string, string>): DbEnvironment {
  const value = (flags.get("db-env") ?? "staging") as DbEnvironment;
  if (!DB_ENVIRONMENTS.includes(value)) {
    throw new PlatformError("CAPTURE_INVALID", {
      reason: `--db-env desconhecido: ${value}`,
      supported: DB_ENVIRONMENTS.join(", "),
    });
  }
  return value;
}

export interface MeasureCommandArgs {
  readonly report: string;
  readonly labels: string | null;
  readonly emitLabels: string | null;
}

export function parseMeasureArgs(argv: readonly string[]): MeasureCommandArgs {
  const flags = toFlagMap(argv);
  return {
    report: required(flags, "report"),
    labels: flags.get("labels") ?? null,
    emitLabels: flags.get("emit-labels") ?? null,
  };
}

export function parseCaptureArgs(argv: readonly string[]): CaptureCommandArgs {
  const flags = toFlagMap(argv);
  const deadline = Number(flags.get("deadline") ?? "15000");
  if (!Number.isFinite(deadline) || deadline <= 0) {
    throw new PlatformError("CAPTURE_INVALID", {
      reason: `--deadline precisa ser um número positivo de milissegundos: ${String(flags.get("deadline"))}`,
    });
  }

  return {
    url: required(flags, "url"),
    journey: required(flags, "journey"),
    out: flags.get("out") ?? ".aletheia/capture",
    label: flags.get("label") ?? "unlabeled",
    commit: flags.get("commit") ?? null,
    seed: flags.get("seed") ?? "0",
    screenshots: flags.get("screenshots") !== "false",
    headed: flags.get("headed") === "true" || flags.get("headed") === "",
    deadlineMs: deadline,
    elements: optional(flags, "elements"),
    db: optional(flags, "db"),
    capabilities: optional(flags, "capabilities"),
    dbEnvironment: dbEnvironmentOf(flags),
    dataStrategy: dataStrategyOf(flags, optional(flags, "db") === null ? null : "shared-degraded"),
  };
}

const CONFIDENCE_MODES: readonly ConfidenceMode[] = ["ISOLATED", "PARTITIONED", "SHARED_DEGRADED"];

export function parseDiffArgs(argv: readonly string[]): DiffCommandArgs {
  const flags = toFlagMap(argv);

  const base = required(flags, "base");
  const head = required(flags, "head");
  const formats = (flags.get("format") ?? "json,html")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  for (const format of formats) {
    if (format !== "json" && format !== "html") {
      throw new PlatformError("CAPTURE_INVALID", {
        reason: `formato de relatório desconhecido: ${format}`,
        supported: "json, html",
      });
    }
  }

  const confidenceMode = (flags.get("confidence-mode") ?? "ISOLATED") as ConfidenceMode;
  if (!CONFIDENCE_MODES.includes(confidenceMode)) {
    throw new PlatformError("CAPTURE_INVALID", {
      reason: `modo de confiança desconhecido: ${confidenceMode}`,
      supported: CONFIDENCE_MODES.join(", "),
    });
  }

  return {
    base,
    head,
    out: flags.get("out") ?? ".aletheia",
    formats: formats as ("json" | "html")[],
    commit: flags.get("commit") ?? null,
    baseRef: flags.get("base-ref") ?? null,
    environment: flags.get("env") ?? "unknown",
    confidenceMode,
    // Fase 0 não executa jornada; o seed é registrado para PA-12 e passa a ter
    // efeito quando o runner interpretador existir (Fase 1).
    seed: flags.get("seed") ?? "0",
    failOnRegression: flags.get("fail-on") !== "none",
    visual: flags.get("visual") !== "false",
    suppressions: flags.get("suppressions") ?? null,
    dataStrategy: dataStrategyOf(flags, null),
  };
}

function toFlagMap(argv: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || !token.startsWith("--")) continue;

    const equals = token.indexOf("=");
    if (equals !== -1) {
      flags.set(token.slice(2, equals), token.slice(equals + 1));
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.set(token.slice(2), "true");
      continue;
    }
    flags.set(token.slice(2), next);
    index += 1;
  }
  return flags;
}

function optional(flags: Map<string, string>, name: string): string | null {
  const value = flags.get(name);
  return value === undefined || value.length === 0 ? null : value;
}

function required(flags: Map<string, string>, name: string): string {
  const value = flags.get(name);
  if (value === undefined || value.length === 0) {
    throw new PlatformError("CAPTURE_INVALID", {
      reason: `argumento obrigatório ausente: --${name}`,
    });
  }
  return value;
}
