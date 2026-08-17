import { PlatformError } from "@aletheia/shared";
import { parse as parseYaml } from "yaml";

import {
  DEFAULT_MAX_ROWS,
  DEFAULT_TIMEOUT_MS,
  type ApprovalStatus,
  type CapabilityEngine,
  type CapabilityOperation,
  type CapabilitySpec,
  type Environment,
  type ParameterType,
  type Sensitivity,
} from "./spec.js";

/**
 * Leitura de capability a partir de YAML (ou de objeto já parseado). Só forma;
 * o que o SQL diz é assunto de `validate.ts`, separado, para o erro dizer se o
 * arquivo está mal escrito ou se a consulta é proibida.
 */

const OPERATIONS: readonly CapabilityOperation[] = ["READ", "WRITE", "DESTRUCTIVE"];
const ENGINES: readonly CapabilityEngine[] = ["sqlite", "postgresql"];
const PARAMETER_TYPES: readonly ParameterType[] = [
  "string",
  "integer",
  "number",
  "boolean",
  "uuid",
];
const SENSITIVITIES: readonly Sensitivity[] = ["LOW", "PII", "FINANCIAL", "SECRET"];
const APPROVALS: readonly ApprovalStatus[] = ["PROPOSED", "APPROVED", "REJECTED"];
const ENVIRONMENTS: readonly Environment[] = ["ephemeral", "isolated", "staging", "production"];

const CAPABILITY_ID = /^cap_[a-z0-9_]+$/;
const CAPABILITY_NAME = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;
const QUALIFIED = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/i;

export function parseCapabilityYaml(text: string, source: string): CapabilitySpec {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (cause) {
    throw new PlatformError(
      "CAPABILITY_INVALID",
      { source, path: "$", reason: "YAML inválido" },
      cause,
    );
  }
  return parseCapability(raw, source);
}

export function parseCapability(raw: unknown, source: string): CapabilitySpec {
  const fail = (path: string, reason: string): never => {
    throw new PlatformError("CAPABILITY_INVALID", { source, path, reason });
  };
  if (!isRecord(raw)) return fail("$", "objeto esperado");

  const id = raw["id"];
  if (typeof id !== "string" || !CAPABILITY_ID.test(id))
    return fail("$.id", "esperado `cap_<slug>`");
  const version = raw["version"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return fail("$.version", "inteiro ≥ 1 esperado");
  }
  const name = raw["name"];
  if (typeof name !== "string" || !CAPABILITY_NAME.test(name)) {
    return fail("$.name", "esperado `<domínio>.<verbo>` (ex.: order.getDiscount)");
  }
  const description = typeof raw["description"] === "string" ? raw["description"] : "";
  const operation = raw["operation"];
  if (typeof operation !== "string" || !OPERATIONS.includes(operation as CapabilityOperation)) {
    return fail("$.operation", `esperado ${OPERATIONS.join(" | ")}`);
  }
  const engine = raw["engine"];
  if (typeof engine !== "string" || !ENGINES.includes(engine as CapabilityEngine)) {
    return fail("$.engine", `esperado ${ENGINES.join(" | ")}`);
  }
  const envsRaw = raw["allowedEnvironments"];
  if (!Array.isArray(envsRaw) || envsRaw.length === 0)
    return fail("$.allowedEnvironments", "lista não vazia esperada");
  const allowedEnvironments = envsRaw.map((entry, index): Environment => {
    if (typeof entry !== "string" || !ENVIRONMENTS.includes(entry as Environment)) {
      return fail(`$.allowedEnvironments[${index}]`, `esperado ${ENVIRONMENTS.join(" | ")}`);
    }
    return entry as Environment;
  });
  const sql = raw["sql"];
  if (typeof sql !== "string" || sql.trim().length === 0) return fail("$.sql", "obrigatório");

  const parametersRaw = raw["parameters"] ?? {};
  if (!isRecord(parametersRaw)) return fail("$.parameters", "objeto esperado");
  const parameters: Record<string, { type: ParameterType; required: boolean }> = {};
  for (const [key, value] of Object.entries(parametersRaw)) {
    if (!IDENTIFIER.test(key)) return fail(`$.parameters.${key}`, "nome de parâmetro inválido");
    if (!isRecord(value)) return fail(`$.parameters.${key}`, "objeto esperado");
    const type = value["type"];
    if (typeof type !== "string" || !PARAMETER_TYPES.includes(type as ParameterType)) {
      return fail(`$.parameters.${key}.type`, `esperado ${PARAMETER_TYPES.join(" | ")}`);
    }
    parameters[key] = { type: type as ParameterType, required: value["required"] !== false };
  }

  const allowlistRaw = raw["allowlist"];
  if (!isRecord(allowlistRaw)) return fail("$.allowlist", "obrigatório (RN-DAT-003)");
  const tables = stringList(allowlistRaw["tables"], "$.allowlist.tables", fail);
  const columns = stringList(allowlistRaw["columns"], "$.allowlist.columns", fail);
  if (tables.length === 0) return fail("$.allowlist.tables", "ao menos uma tabela (RN-DAT-003)");
  for (const table of tables)
    if (!IDENTIFIER.test(table)) return fail("$.allowlist.tables", `nome inválido: ${table}`);
  for (const column of columns) {
    if (!QUALIFIED.test(column))
      return fail("$.allowlist.columns", `esperado tabela.coluna: ${column}`);
  }

  const sensitivityRaw = raw["sensitivity"] ?? {};
  if (!isRecord(sensitivityRaw)) return fail("$.sensitivity", "objeto esperado");
  const sensitivity: Record<string, Sensitivity> = {};
  for (const [column, level] of Object.entries(sensitivityRaw)) {
    if (!QUALIFIED.test(column)) return fail(`$.sensitivity.${column}`, "esperado tabela.coluna");
    if (typeof level !== "string" || !SENSITIVITIES.includes(level as Sensitivity)) {
      return fail(`$.sensitivity.${column}`, `esperado ${SENSITIVITIES.join(" | ")}`);
    }
    sensitivity[column] = level as Sensitivity;
  }

  const constraintsRaw = isRecord(raw["constraints"]) ? raw["constraints"] : {};
  const timeoutMs = positiveInt(constraintsRaw["timeoutMs"], DEFAULT_TIMEOUT_MS);
  const maxRows = positiveInt(constraintsRaw["maxRows"], DEFAULT_MAX_ROWS);

  const keyColumns = stringList(raw["keyColumns"] ?? [], "$.keyColumns", fail);
  const volatileColumns = stringList(raw["volatileColumns"] ?? [], "$.volatileColumns", fail);

  const approvalRaw = isRecord(raw["approval"]) ? raw["approval"] : {};
  const status = approvalRaw["status"] ?? "PROPOSED";
  if (typeof status !== "string" || !APPROVALS.includes(status as ApprovalStatus)) {
    return fail("$.approval.status", `esperado ${APPROVALS.join(" | ")}`);
  }
  const approvedBy = optionalString(approvalRaw["approvedBy"]);
  if (status === "APPROVED" && approvedBy === null) {
    return fail(
      "$.approval.approvedBy",
      "APPROVED sem aprovador identificado — aprovação nunca é anônima",
    );
  }

  return {
    id,
    version,
    name,
    description,
    operation: operation as CapabilityOperation,
    engine: engine as CapabilityEngine,
    allowedEnvironments,
    sql: sql.trim(),
    parameters,
    allowlist: { tables, columns },
    sensitivity,
    constraints: { timeoutMs, maxRows },
    keyColumns,
    volatileColumns,
    approval: {
      status: status as ApprovalStatus,
      approvedBy,
      approvedAt: optionalString(approvalRaw["approvedAt"]),
      reviewPr: optionalString(approvalRaw["reviewPr"]),
    },
  };
}

function stringList(
  raw: unknown,
  path: string,
  fail: (path: string, reason: string) => never,
): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return fail(path, "lista esperada");
  return raw.map((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0)
      return fail(`${path}[${index}]`, "string esperada");
    return entry;
  });
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
