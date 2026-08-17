import { PlatformError, stableHash, type Logger } from "@aletheia/shared";

import type { CapabilitySpec, Environment, ParameterValue } from "../spec.js";
import { validateCapability } from "../validate.js";

import type { EngineAdapter } from "./adapter.js";
import { openSqlite } from "./sqlite.js";

/**
 * Executor de capabilities — RUNTIME da §14.2: "Runner invoca
 * capability("order.getDiscount", { orderId }). Executor: conexão de privilégio
 * mínimo, timeout, LIMIT, audit". Nenhum modelo por perto (PA-01, RN-DAT-001).
 *
 * O que ele garante, na ordem em que verifica:
 *
 *   1. a capability existe no catálogo e passou na validação estática;
 *   2. está APPROVED — PROPOSED é pergunta, REJECTED é resposta;
 *   3. é READ (nesta fase) e o ambiente está em `allowedEnvironments`;
 *   4. os parâmetros batem com o declarado (tipo, obrigatoriedade) — nada
 *      passa por interpolação: tudo vira parâmetro nomeado do driver;
 *   5. `LIMIT` compulsório quando ausente (RN-DAT-004);
 *   6. colunas PII/SECRET são mascaradas ANTES de a linha sair daqui
 *      (RN-DAT-008) — por hash estável, para que base e head continuem
 *      comparáveis sem que o valor exista em lugar nenhum;
 *   7. linha de auditoria: capability, ambiente, linhas, duração. Nunca valores.
 */

export interface DatabaseResult {
  readonly capability: string;
  readonly params: Readonly<Record<string, ParameterValue>>;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (string | number | boolean | null)[])[];
  readonly rowCount: number;
  /** `true` quando o LIMIT (declarado ou compulsório) cortou o resultado. */
  readonly truncated: boolean;
  readonly keyColumns: readonly string[];
  readonly volatileColumns: readonly string[];
  readonly durationMs: number;
  /** Colunas mascaradas na borda; o valor no `rows` é `<masked:hash>`. */
  readonly maskedColumns: readonly string[];
}

export interface CapabilityCatalog {
  readonly specs: readonly CapabilitySpec[];
}

export function findCapability(catalog: CapabilityCatalog, name: string): CapabilitySpec | null {
  return catalog.specs.find((spec) => spec.name === name) ?? null;
}

export interface ExecutorOptions {
  readonly catalog: CapabilityCatalog;
  readonly environment: Environment;
  readonly logger: Logger;
}

export interface CapabilityExecutor {
  execute(name: string, params: Readonly<Record<string, ParameterValue>>): Promise<DatabaseResult>;
  close(): Promise<void>;
}

/**
 * Abre o executor para uma URL de conexão. A URL nunca é logada nem guardada
 * em erro. Engines suportados nesta fase: `sqlite:<caminho>` / `file:<caminho>`.
 */
export function openExecutor(connectionUrl: string, options: ExecutorOptions): CapabilityExecutor {
  const adapter = adapterFor(connectionUrl);
  return createExecutor(adapter, options);
}

export function createExecutor(
  adapter: EngineAdapter,
  options: ExecutorOptions,
): CapabilityExecutor {
  return {
    async execute(name, params) {
      const spec = findCapability(options.catalog, name);
      if (spec === null) {
        throw new PlatformError("CAPABILITY_REJECTED", {
          capability: name,
          reason: "não está no catálogo",
        });
      }
      const validation = validateCapability(spec);
      if (validation.issues.length > 0) {
        throw new PlatformError("CAPABILITY_INVALID", {
          capability: name,
          reason: validation.issues.map((issue) => issue.problem).join("; "),
        });
      }
      if (spec.approval.status !== "APPROVED") {
        throw new PlatformError("CAPABILITY_REJECTED", {
          capability: name,
          reason: `status ${spec.approval.status} — só APPROVED executa (§14.2)`,
        });
      }
      if (spec.operation !== "READ") {
        throw new PlatformError("CAPABILITY_REJECTED", {
          capability: name,
          reason: `operação ${spec.operation} não é executável nesta fase`,
        });
      }
      if (!spec.allowedEnvironments.includes(options.environment)) {
        throw new PlatformError("CAPABILITY_REJECTED", {
          capability: name,
          reason: `ambiente ${options.environment} não está em allowedEnvironments (${spec.allowedEnvironments.join(", ")})`,
        });
      }
      if (spec.engine !== adapter.engine) {
        throw new PlatformError("CAPABILITY_REJECTED", {
          capability: name,
          reason: `capability é para ${spec.engine}; conexão é ${adapter.engine}`,
        });
      }

      const bound = bindParameters(spec, params);
      const sql = validation.limitMissing
        ? `${spec.sql} LIMIT ${spec.constraints.maxRows}`
        : spec.sql;

      const startedAt = performance.now();
      const raw = await adapter.query(sql, bound, spec.constraints.timeoutMs);
      const durationMs = Math.round(performance.now() - startedAt);

      const truncated = raw.rows.length > spec.constraints.maxRows;
      const rows = raw.rows.slice(0, spec.constraints.maxRows);
      const masked = maskedColumnsOf(spec, raw.columns);
      const maskedIndexes = new Set(masked.map((column) => raw.columns.indexOf(column)));

      const result: DatabaseResult = {
        capability: spec.name,
        params: bound,
        columns: raw.columns,
        rows: rows.map((row) =>
          row.map((value, index) =>
            maskedIndexes.has(index) && value !== null
              ? `<masked:${stableHash(String(value)).slice(0, 12)}>`
              : value,
          ),
        ),
        rowCount: rows.length,
        truncated,
        keyColumns: spec.keyColumns,
        volatileColumns: spec.volatileColumns,
        durationMs,
        maskedColumns: masked,
      };

      // Auditoria (§14.8): quem, o quê, quanto. Nunca valores, nunca a URL.
      options.logger.info("capability executada", {
        capability: spec.name,
        capabilityId: spec.id,
        version: spec.version,
        environment: options.environment,
        rows: result.rowCount,
        truncated,
        durationMs,
        maskedColumns: masked.length,
      });
      return result;
    },
    close: () => adapter.close(),
  };
}

function adapterFor(connectionUrl: string): EngineAdapter {
  if (connectionUrl.startsWith("sqlite:")) return openSqlite(connectionUrl.slice("sqlite:".length));
  if (connectionUrl.startsWith("file:")) return openSqlite(connectionUrl.slice("file:".length));
  const scheme = connectionUrl.split(":")[0] ?? "";
  throw new PlatformError("DATABASE_UNREACHABLE", {
    engine: scheme,
    reason:
      "engine não suportado nesta fase (sqlite: | file:); postgresql entra com o primeiro piloto",
  });
}

function bindParameters(
  spec: CapabilitySpec,
  params: Readonly<Record<string, ParameterValue>>,
): Record<string, ParameterValue> {
  const bound: Record<string, ParameterValue> = {};
  for (const [name, declared] of Object.entries(spec.parameters)) {
    const value = params[name];
    if (value === undefined) {
      if (declared.required) {
        throw new PlatformError("CAPABILITY_REJECTED", {
          capability: spec.name,
          reason: `parâmetro obrigatório ausente: ${name}`,
        });
      }
      continue;
    }
    if (!typeMatches(declared.type, value)) {
      throw new PlatformError("CAPABILITY_REJECTED", {
        capability: spec.name,
        reason: `parâmetro ${name} deveria ser ${declared.type}`,
      });
    }
    bound[name] = value;
  }
  for (const name of Object.keys(params)) {
    if (spec.parameters[name] === undefined) {
      throw new PlatformError("CAPABILITY_REJECTED", {
        capability: spec.name,
        reason: `parâmetro não declarado: ${name}`,
      });
    }
  }
  return bound;
}

function typeMatches(
  type: CapabilitySpec["parameters"][string]["type"],
  value: ParameterValue,
): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "uuid":
      return (
        typeof value === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
      );
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
  }
}

function maskedColumnsOf(spec: CapabilitySpec, columns: readonly string[]): string[] {
  const sensitive = new Set(
    Object.entries(spec.sensitivity)
      .filter(([, level]) => level === "PII" || level === "SECRET")
      .map(([column]) => column.split(".").pop() ?? column),
  );
  return columns.filter((column) => sensitive.has(column));
}
