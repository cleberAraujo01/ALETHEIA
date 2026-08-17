import { PlatformError } from "@aletheia/shared";

import type { Rect, Viewport } from "./schema.js";

/**
 * Formato legado da Fase 0 — `journeyVersion: "0.1.0"`, uma lista de rotas.
 *
 * Continua aceito para sempre por dois motivos: os fixtures e a bancada da
 * Fase 0 são escritos nele, e uma jornada só de rotas é o caso mais comum de
 * onboarding ("me diga cinco URLs"). Ele é migrado para IR na leitura
 * (`migrate.ts`); o runner nunca vê este formato.
 */
export const LEGACY_JOURNEY_VERSION = "0.1.0";

export interface LegacyJourney {
  readonly journeyVersion: typeof LEGACY_JOURNEY_VERSION;
  readonly name: string;
  readonly viewport: Viewport;
  readonly observations: readonly LegacyObservation[];
}

export interface LegacyObservation {
  readonly observationId: string;
  readonly path: string;
  readonly masks: readonly Rect[];
}

export function parseLegacyJourney(raw: unknown, source: string): LegacyJourney {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new PlatformError("IR_INVALID", { source, path: "$", reason: "objeto esperado" });
  }
  const root = raw as Record<string, unknown>;
  if (root["journeyVersion"] !== LEGACY_JOURNEY_VERSION) {
    throw new PlatformError("IR_VERSION_UNSUPPORTED", {
      source,
      found: String(root["journeyVersion"]),
      supported: LEGACY_JOURNEY_VERSION,
    });
  }
  const observationsRaw = root["observations"];
  if (!Array.isArray(observationsRaw) || observationsRaw.length === 0) {
    throw new PlatformError("IR_INVALID", {
      source,
      path: "$.observations",
      reason: "jornada precisa de ao menos uma observação",
    });
  }
  const viewportRaw = (root["viewport"] ?? {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const observations = observationsRaw.map((entry, index): LegacyObservation => {
    const node = (entry ?? {}) as Record<string, unknown>;
    const observationId = node["observationId"];
    const path = node["path"];
    if (typeof observationId !== "string" || typeof path !== "string") {
      throw new PlatformError("IR_INVALID", {
        source,
        path: `$.observations[${index}]`,
        reason: "precisa de observationId e path",
      });
    }
    if (seen.has(observationId)) {
      throw new PlatformError("IR_INVALID", {
        source,
        path: `$.observations[${index}].observationId`,
        reason: `duplicado: ${observationId}`,
      });
    }
    seen.add(observationId);
    return {
      observationId,
      path,
      masks: Array.isArray(node["masks"]) ? (node["masks"] as Rect[]) : [],
    };
  });
  return {
    journeyVersion: LEGACY_JOURNEY_VERSION,
    name: typeof root["name"] === "string" ? root["name"] : "sem-nome",
    viewport: {
      width: typeof viewportRaw["width"] === "number" ? viewportRaw["width"] : 1280,
      height: typeof viewportRaw["height"] === "number" ? viewportRaw["height"] : 800,
    },
    observations,
  };
}
