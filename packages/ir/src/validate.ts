import { PlatformError } from "@aletheia/shared";

import {
  IR_ACTIONS,
  IR_VERSION,
  type IrAction,
  type IrJourney,
  type IrStep,
  type IrValue,
  type Rect,
  type Target,
  type TargetSpec,
} from "./schema.js";

/**
 * Validação estrutural da IR v1. Sem dependência externa, de propósito: a IR
 * roda no caminho de gate (PA-01), e o validador precisa ser tão auditável
 * quanto o que ele valida.
 *
 * Todo problema é `PlatformError` `IR_INVALID`: uma jornada mal escrita é
 * problema nosso ou do autor da jornada — nunca reprovação do código do
 * cliente (RN-CI-005). A mensagem diz ONDE (`steps[3].target`) e O QUÊ.
 */
export function parseIr(raw: unknown, source: string): IrJourney {
  const fail = (path: string, reason: string): never => {
    throw new PlatformError("IR_INVALID", { source, path, reason });
  };
  if (!isRecord(raw)) return fail("$", "objeto esperado");
  if (raw["irVersion"] !== IR_VERSION) {
    throw new PlatformError("IR_VERSION_UNSUPPORTED", {
      source,
      found: String(raw["irVersion"]),
      supported: IR_VERSION,
    });
  }
  const id = raw["id"];
  if (typeof id !== "string" || !/^jr_[A-Za-z0-9_-]+$/.test(id)) {
    return fail("$.id", "esperado `jr_<slug>`");
  }
  const name = typeof raw["name"] === "string" && raw["name"].length > 0 ? raw["name"] : id;

  const viewportRaw = isRecord(raw["viewport"]) ? raw["viewport"] : {};
  const viewport = {
    width: numberOr(viewportRaw["width"], 1280),
    height: numberOr(viewportRaw["height"], 800),
  };

  const stepsRaw = raw["steps"];
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
    return fail("$.steps", "jornada precisa de ao menos um passo");
  }

  const stepIds = new Set<string>();
  const observationIds = new Set<string>();
  let navigated = false;

  const steps = stepsRaw.map((entry, index): IrStep => {
    const where = `$.steps[${index}]`;
    if (!isRecord(entry)) return fail(where, "objeto esperado");
    const stepId = entry["id"];
    if (typeof stepId !== "string" || stepId.length === 0)
      return fail(`${where}.id`, "obrigatório");
    if (stepIds.has(stepId)) return fail(`${where}.id`, `duplicado: ${stepId}`);
    stepIds.add(stepId);

    const action = entry["action"];
    if (typeof action !== "string" || !IR_ACTIONS.includes(action as IrAction)) {
      return fail(`${where}.action`, `desconhecida: ${String(action)} (${IR_ACTIONS.join(" | ")})`);
    }

    // Toda ação sobre a página exige que a página exista: navegar primeiro.
    if (action !== "navigate" && !navigated) {
      return fail(where, `"${action}" antes de qualquer "navigate" — não há página`);
    }

    switch (action as IrAction) {
      case "navigate": {
        const path = entry["path"];
        if (typeof path !== "string" || path.length === 0)
          return fail(`${where}.path`, "obrigatório");
        navigated = true;
        return { id: stepId, action: "navigate", path };
      }
      case "click":
        return {
          id: stepId,
          action: "click",
          target: parseTarget(entry["target"], `${where}.target`, fail),
        };
      case "fill":
        return {
          id: stepId,
          action: "fill",
          target: parseTarget(entry["target"], `${where}.target`, fail),
          value: parseValue(entry["value"], `${where}.value`, fail),
        };
      case "select": {
        const value = entry["value"];
        if (typeof value !== "string") return fail(`${where}.value`, "string esperada");
        return {
          id: stepId,
          action: "select",
          target: parseTarget(entry["target"], `${where}.target`, fail),
          value,
        };
      }
      case "press": {
        const key = entry["key"];
        if (typeof key !== "string" || key.length === 0) return fail(`${where}.key`, "obrigatório");
        const target =
          entry["target"] === undefined
            ? undefined
            : parseTarget(entry["target"], `${where}.target`, fail);
        return target === undefined
          ? { id: stepId, action: "press", key }
          : { id: stepId, action: "press", key, target };
      }
      case "observe": {
        const observationId = entry["observationId"];
        if (typeof observationId !== "string" || observationId.length === 0) {
          return fail(`${where}.observationId`, "obrigatório");
        }
        if (observationIds.has(observationId)) {
          return fail(`${where}.observationId`, `duplicado: ${observationId}`);
        }
        observationIds.add(observationId);
        const masksRaw = entry["masks"];
        const masks = Array.isArray(masksRaw)
          ? masksRaw.map((mask, at) => parseRect(mask, `${where}.masks[${at}]`, fail))
          : [];
        return { id: stepId, action: "observe", observationId, masks };
      }
    }
  });

  if (observationIds.size === 0) {
    return fail(
      "$.steps",
      'jornada sem nenhum "observe" não produz evidência — não há o que comparar',
    );
  }

  return { irVersion: IR_VERSION, id, name, viewport, steps };
}

const SEMANTIC_SIGNALS = ["testId", "role", "label", "placeholder", "text", "field"] as const;

const ELEMENT_REF = /^el_[A-Za-z0-9_-]+$/;

function parseTarget(
  raw: unknown,
  where: string,
  fail: (path: string, reason: string) => never,
): TargetSpec {
  if (!isRecord(raw)) return fail(where, "objeto esperado");
  if (raw["ref"] !== undefined) {
    if (typeof raw["ref"] !== "string" || !ELEMENT_REF.test(raw["ref"])) {
      return fail(`${where}.ref`, "esperado `el_<slug>` do repositório de elementos");
    }
    if (Object.keys(raw).length > 1) {
      return fail(
        where,
        "`ref` não se mistura com sinais inline: ou o fingerprint mora no repositório, ou aqui",
      );
    }
    return { ref: raw["ref"] };
  }
  return parseFingerprint(raw, where, fail);
}

export function parseFingerprint(
  raw: Record<string, unknown>,
  where: string,
  fail: (path: string, reason: string) => never,
): Target {
  const target: Record<string, string | number> = {};
  for (const key of [
    "testId",
    "role",
    "name",
    "label",
    "placeholder",
    "text",
    "field",
    "css",
  ] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length === 0)
      return fail(`${where}.${key}`, "string não vazia esperada");
    target[key] = value;
  }
  if (raw["nth"] !== undefined) {
    if (typeof raw["nth"] !== "number" || !Number.isInteger(raw["nth"]) || raw["nth"] < 0) {
      return fail(`${where}.nth`, "inteiro ≥ 0 esperado");
    }
    target["nth"] = raw["nth"];
  }
  if (target["role"] !== undefined && target["name"] === undefined) {
    return fail(`${where}.role`, "`role` sem `name` não identifica nada — informe os dois");
  }
  if (target["name"] !== undefined && target["role"] === undefined) {
    return fail(`${where}.name`, "`name` sem `role` — informe os dois");
  }
  if (!SEMANTIC_SIGNALS.some((key) => target[key] !== undefined)) {
    return fail(
      where,
      "alvo precisa de ao menos um sinal semântico (testId, role+name, label, placeholder, text, field); " +
        "`css` sozinho é seletor único (CLAUDE.md §3.5)",
    );
  }
  return target;
}

function parseValue(
  raw: unknown,
  where: string,
  fail: (path: string, reason: string) => never,
): IrValue {
  if (typeof raw === "string") return raw;
  if (
    isRecord(raw) &&
    typeof raw["secretRef"] === "string" &&
    /^[A-Z][A-Z0-9_]*$/.test(raw["secretRef"])
  ) {
    return { secretRef: raw["secretRef"] };
  }
  return fail(where, "string ou { secretRef: NOME_DA_VARIAVEL_DE_AMBIENTE }");
}

function parseRect(
  raw: unknown,
  where: string,
  fail: (path: string, reason: string) => never,
): Rect {
  if (!isRecord(raw)) return fail(where, "objeto esperado");
  const rect: Record<string, number> = {};
  for (const key of ["x", "y", "width", "height"] as const) {
    const value = raw[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return fail(`${where}.${key}`, "número ≥ 0 esperado");
    }
    rect[key] = value;
  }
  return rect as unknown as Rect;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
