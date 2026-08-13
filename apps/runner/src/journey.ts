import type { Rect } from "@aletheia/diff-engine";
import { PlatformError } from "@aletheia/shared";

/**
 * Jornada de captura — Fase 0.
 *
 * Deliberadamente **sem ações**: a jornada é uma lista de rotas a visitar.
 * Clique, digitação e asserção pertencem à IR (Fase 1, E-03/E-04), e começar a
 * inventar um mini-formato de passos aqui seria criar uma IR paralela que
 * depois teria de ser abandonada.
 *
 * Consequência honesta e declarada: nesta fase só se observa o que é
 * alcançável por URL. Tela atrás de fluxo com estado não entra.
 */
export const JOURNEY_VERSION = "0.1.0";

export interface Journey {
  readonly journeyVersion: string;
  readonly name: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly observations: readonly JourneyObservation[];
}

export interface JourneyObservation {
  /** Chave semântica de alinhamento. Precisa ser igual em base e head. */
  readonly observationId: string;
  /** Caminho relativo à baseUrl. */
  readonly path: string;
  /** Regiões sabidamente dinâmicas, excluídas da comparação visual. */
  readonly masks: readonly Rect[];
}

export function parseJourney(raw: unknown, source: string): Journey {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new PlatformError("CAPTURE_INVALID", { source, reason: "objeto esperado" });
  }
  const root = raw as Record<string, unknown>;

  const version = root["journeyVersion"];
  if (version !== JOURNEY_VERSION) {
    throw new PlatformError("CAPTURE_VERSION_UNSUPPORTED", {
      source,
      found: String(version),
      supported: JOURNEY_VERSION,
    });
  }

  const observationsRaw = root["observations"];
  if (!Array.isArray(observationsRaw) || observationsRaw.length === 0) {
    throw new PlatformError("CAPTURE_INVALID", {
      source,
      reason: "jornada precisa de ao menos uma observação",
    });
  }

  const viewportRaw = (root["viewport"] ?? {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const observations = observationsRaw.map((entry, index): JourneyObservation => {
    const node = entry as Record<string, unknown>;
    const observationId = node["observationId"];
    const path = node["path"];
    if (typeof observationId !== "string" || typeof path !== "string") {
      throw new PlatformError("CAPTURE_INVALID", {
        source,
        reason: `observação ${index} precisa de observationId e path`,
      });
    }
    if (seen.has(observationId)) {
      throw new PlatformError("CAPTURE_INVALID", {
        source,
        reason: `observationId duplicado: ${observationId}`,
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
    journeyVersion: JOURNEY_VERSION,
    name: typeof root["name"] === "string" ? root["name"] : "sem-nome",
    viewport: {
      width: typeof viewportRaw["width"] === "number" ? viewportRaw["width"] : 1280,
      height: typeof viewportRaw["height"] === "number" ? viewportRaw["height"] : 800,
    },
    observations,
  };
}
