import { PlatformError } from "@aletheia/shared";

import {
  SUPPORTED_CAPTURE_VERSIONS,
  type Capture,
  type ConsoleEntry,
  type DomNode,
  type JsonValue,
  type NetworkExchange,
  type Observation,
  type Rect,
  type ScreenshotRef,
} from "../types/capture.js";

/**
 * Validação do artefato de captura.
 *
 * Captura malformada é falha de PLATAFORMA, nunca veredito de qualidade
 * (RN-CI-005): se não conseguimos ler o que capturamos, o problema é nosso e o
 * PR do cliente não pode ser reprovado por isso.
 */
export function parseCapture(raw: unknown, source: string): Capture {
  const root = requireObject(raw, "$", source);

  const captureVersion = requireString(root["captureVersion"], "$.captureVersion", source);
  if (!SUPPORTED_CAPTURE_VERSIONS.includes(captureVersion)) {
    throw new PlatformError("CAPTURE_VERSION_UNSUPPORTED", {
      source,
      found: captureVersion,
      supported: SUPPORTED_CAPTURE_VERSIONS.join(", "),
    });
  }

  const targetRaw = requireObject(root["target"], "$.target", source);
  const observationsRaw = requireArray(root["observations"], "$.observations", source);

  const observations = observationsRaw.map((entry, index) =>
    parseObservation(entry, `$.observations[${index}]`, source),
  );

  const ids = new Set<string>();
  for (const observation of observations) {
    if (ids.has(observation.observationId)) {
      throw new PlatformError("CAPTURE_INVALID", {
        source,
        path: "$.observations",
        reason: `observationId duplicado: ${observation.observationId}`,
      });
    }
    ids.add(observation.observationId);
  }

  return {
    captureVersion,
    captureId: requireString(root["captureId"], "$.captureId", source),
    target: {
      label: requireString(targetRaw["label"], "$.target.label", source),
      baseUrl: requireString(targetRaw["baseUrl"], "$.target.baseUrl", source),
      commit: optionalString(targetRaw["commit"], "$.target.commit", source),
      capturedAtUtc: requireString(targetRaw["capturedAtUtc"], "$.target.capturedAtUtc", source),
    },
    observations,
  };
}

function parseObservation(raw: unknown, path: string, source: string): Observation {
  const node = requireObject(raw, path, source);
  return {
    observationId: requireString(node["observationId"], `${path}.observationId`, source),
    route: requireString(node["route"], `${path}.route`, source),
    url: requireString(node["url"], `${path}.url`, source),
    dom: node["dom"] == null ? null : parseDomNode(node["dom"], `${path}.dom`, source),
    network:
      node["network"] == null
        ? null
        : requireArray(node["network"], `${path}.network`, source).map((entry, index) =>
            parseExchange(entry, `${path}.network[${index}]`, source),
          ),
    console:
      node["console"] == null
        ? null
        : requireArray(node["console"], `${path}.console`, source).map((entry, index) =>
            parseConsoleEntry(entry, `${path}.console[${index}]`, source),
          ),
    screenshot:
      node["screenshot"] == null
        ? null
        : parseScreenshot(node["screenshot"], `${path}.screenshot`, source),
  };
}

function parseScreenshot(raw: unknown, path: string, source: string): ScreenshotRef {
  const node = requireObject(raw, path, source);
  return {
    path: requireString(node["path"], `${path}.path`, source),
    width: requireNumber(node["width"], `${path}.width`, source),
    height: requireNumber(node["height"], `${path}.height`, source),
    masks:
      node["masks"] == null
        ? []
        : requireArray(node["masks"], `${path}.masks`, source).map((entry, index) =>
            parseRect(entry, `${path}.masks[${index}]`, source),
          ),
  };
}

function parseRect(raw: unknown, path: string, source: string): Rect {
  const node = requireObject(raw, path, source);
  return {
    x: requireNumber(node["x"], `${path}.x`, source),
    y: requireNumber(node["y"], `${path}.y`, source),
    width: requireNumber(node["width"], `${path}.width`, source),
    height: requireNumber(node["height"], `${path}.height`, source),
  };
}

function parseDomNode(raw: unknown, path: string, source: string): DomNode {
  const node = requireObject(raw, path, source);
  const attributesRaw =
    node["attributes"] == null
      ? {}
      : requireObject(node["attributes"], `${path}.attributes`, source);

  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributesRaw)) {
    if (typeof value !== "string") {
      throw new PlatformError("CAPTURE_INVALID", {
        source,
        path: `${path}.attributes.${key}`,
        reason: "valor de atributo deve ser string",
      });
    }
    attributes[key] = value;
  }

  return {
    tag: requireString(node["tag"], `${path}.tag`, source),
    attributes,
    text: optionalString(node["text"], `${path}.text`, source),
    role: optionalString(node["role"], `${path}.role`, source),
    accessibleName: optionalString(node["accessibleName"], `${path}.accessibleName`, source),
    children:
      node["children"] == null
        ? []
        : requireArray(node["children"], `${path}.children`, source).map((child, index) =>
            parseDomNode(child, `${path}.children[${index}]`, source),
          ),
  };
}

function parseExchange(raw: unknown, path: string, source: string): NetworkExchange {
  const node = requireObject(raw, path, source);
  return {
    method: requireString(node["method"], `${path}.method`, source),
    url: requireString(node["url"], `${path}.url`, source),
    status: requireNumber(node["status"], `${path}.status`, source),
    resourceType:
      node["resourceType"] == null
        ? "other"
        : requireString(node["resourceType"], `${path}.resourceType`, source),
    requestBody: asJsonValue(node["requestBody"]),
    responseBody: asJsonValue(node["responseBody"]),
    durationMs:
      node["durationMs"] == null
        ? null
        : requireNumber(node["durationMs"], `${path}.durationMs`, source),
  };
}

function parseConsoleEntry(raw: unknown, path: string, source: string): ConsoleEntry {
  const node = requireObject(raw, path, source);
  const level = requireString(node["level"], `${path}.level`, source);
  if (level !== "log" && level !== "info" && level !== "warn" && level !== "error") {
    throw new PlatformError("CAPTURE_INVALID", {
      source,
      path: `${path}.level`,
      reason: `nível de console desconhecido: ${level}`,
    });
  }
  return { level, text: requireString(node["text"], `${path}.text`, source) };
}

function asJsonValue(value: unknown): JsonValue | null {
  return value === undefined ? null : (value as JsonValue | null);
}

function requireObject(value: unknown, path: string, source: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PlatformError("CAPTURE_INVALID", { source, path, reason: "objeto esperado" });
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, path: string, source: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new PlatformError("CAPTURE_INVALID", { source, path, reason: "array esperado" });
  }
  return value;
}

function requireString(value: unknown, path: string, source: string): string {
  if (typeof value !== "string") {
    throw new PlatformError("CAPTURE_INVALID", { source, path, reason: "string esperada" });
  }
  return value;
}

function requireNumber(value: unknown, path: string, source: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new PlatformError("CAPTURE_INVALID", { source, path, reason: "número esperado" });
  }
  return value;
}

function optionalString(value: unknown, path: string, source: string): string | null {
  if (value == null) return null;
  return requireString(value, path, source);
}
