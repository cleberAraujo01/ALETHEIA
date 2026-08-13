/**
 * Log estruturado.
 *
 * Duas restrições vêm da arquitetura, não de gosto:
 *
 * 1. Todo log carrega `runId`, `orgId` e `projectId`. Em Fase 0 não existe
 *    tenancy, então `orgId`/`projectId` são `null` — declarados, não omitidos.
 * 2. Campos só aceitam escalares. Isso é intencional: impede que alguém
 *    despeje um payload de resposta, um corpo de request ou uma linha de banco
 *    no log por acidente (PA-09, RN-SEC-007). Se você precisa registrar a forma
 *    de um dado, registre contagem, tipo e cardinalidade — nunca o valor.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Readonly<Record<string, string | number | boolean | null>>;

export interface LogContext {
  readonly runId: string;
  readonly orgId: string | null;
  readonly projectId: string | null;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(extra: LogFields): Logger;
}

export interface LoggerOptions {
  readonly context: LogContext;
  readonly minLevel?: LogLevel;
  /**
   * Destino. Default é `stderr` — stdout fica livre para a saída de dados da
   * CLI, que precisa ser pipeável sem contaminação de log.
   */
  readonly write?: (line: string) => void;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createLogger(options: LoggerOptions): Logger {
  const minLevel = options.minLevel ?? "info";
  const write = options.write ?? ((line: string) => process.stderr.write(`${line}\n`));
  const base: LogFields = {
    runId: options.context.runId,
    orgId: options.context.orgId,
    projectId: options.context.projectId,
  };

  const build = (bound: LogFields): Logger => {
    const emit = (level: LogLevel, message: string, fields: LogFields = {}): void => {
      if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) {
        return;
      }
      write(
        JSON.stringify({
          ts: new Date().toISOString(),
          level,
          message,
          ...bound,
          ...fields,
        }),
      );
    };

    return {
      debug: (message, fields) => {
        emit("debug", message, fields);
      },
      info: (message, fields) => {
        emit("info", message, fields);
      },
      warn: (message, fields) => {
        emit("warn", message, fields);
      },
      error: (message, fields) => {
        emit("error", message, fields);
      },
      child: (extra) => build({ ...bound, ...extra }),
    };
  };

  return build(base);
}
