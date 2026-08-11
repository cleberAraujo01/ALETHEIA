import { PlatformError, type ConfidenceMode } from "@aletheia/shared";

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
  };
}

const CONFIDENCE_MODES: readonly ConfidenceMode[] = [
  "ISOLATED",
  "PARTITIONED",
  "SHARED_DEGRADED",
];

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

function required(flags: Map<string, string>, name: string): string {
  const value = flags.get(name);
  if (value === undefined || value.length === 0) {
    throw new PlatformError("CAPTURE_INVALID", { reason: `argumento obrigatório ausente: --${name}` });
  }
  return value;
}
