import { PlatformError } from "@aletheia/shared";

import { LEGACY_JOURNEY_VERSION, parseLegacyJourney, type LegacyJourney } from "./legacy.js";
import { IR_VERSION, type IrJourney, type IrStep } from "./schema.js";
import { parseIr } from "./validate.js";

/**
 * Migração de schema — testada nas duas direções (CLAUDE.md §7).
 *
 * `0.1.0 → 1.0.0` é total: cada rota vira `navigate` + `observe`.
 * `1.0.0 → 0.1.0` é PARCIAL, e diz quando não dá: uma IR com ação (clique,
 * digitação) não cabe numa lista de rotas, e fingir que cabe seria descartar
 * passos em silêncio. Migração que perde informação sem avisar é bug de
 * arquitetura, não conveniência.
 */

export function journeyToIr(journey: LegacyJourney): IrJourney {
  const steps: IrStep[] = [];
  journey.observations.forEach((observation, index) => {
    steps.push({ id: `st_${index + 1}_nav`, action: "navigate", path: observation.path });
    steps.push({
      id: `st_${index + 1}_obs`,
      action: "observe",
      observationId: observation.observationId,
      masks: observation.masks,
      database: [],
      relations: [],
    });
  });
  return {
    irVersion: IR_VERSION,
    id: `jr_${slug(journey.name)}`,
    name: journey.name,
    viewport: journey.viewport,
    steps,
  };
}

/** @throws PlatformError `IR_INVALID` se a IR tiver passo que o formato legado não representa. */
export function irToJourney(ir: IrJourney): LegacyJourney {
  const observations: LegacyJourney["observations"][number][] = [];
  let pendingPath: string | null = null;
  for (const step of ir.steps) {
    if (step.action === "navigate") {
      pendingPath = step.path;
      continue;
    }
    if (step.action === "observe") {
      if (step.database.length > 0) {
        throw new PlatformError("IR_INVALID", {
          source: ir.id,
          path: step.id,
          reason:
            "sonda de banco não existe no formato 0.1.0 — a migração para baixo perderia a capability",
        });
      }
      if (step.relations.length > 0) {
        throw new PlatformError("IR_INVALID", {
          source: ir.id,
          path: step.id,
          reason:
            "relação metamórfica não existe no formato 0.1.0 — a migração para baixo perderia a verificação",
        });
      }
      if (pendingPath === null) {
        throw new PlatformError("IR_INVALID", {
          source: ir.id,
          path: step.id,
          reason: "observe sem navigate imediatamente antes não cabe no formato 0.1.0",
        });
      }
      observations.push({
        observationId: step.observationId,
        path: pendingPath,
        masks: step.masks,
      });
      pendingPath = null;
      continue;
    }
    throw new PlatformError("IR_INVALID", {
      source: ir.id,
      path: step.id,
      reason: `ação "${step.action}" não existe no formato 0.1.0 — a migração para baixo perderia o passo`,
    });
  }
  return {
    journeyVersion: LEGACY_JOURNEY_VERSION,
    name: ir.name,
    viewport: ir.viewport,
    observations,
  };
}

/**
 * Ponto de entrada de quem lê jornada de arquivo: aceita IR v1 e o formato
 * legado, e devolve sempre IR. `migrated` diz se houve migração, para o
 * chamador registrar (PA-12: a execução declara o que interpretou).
 */
export function loadJourney(raw: unknown, source: string): { ir: IrJourney; migrated: boolean } {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const root = raw as Record<string, unknown>;
    if (root["journeyVersion"] === LEGACY_JOURNEY_VERSION) {
      return { ir: journeyToIr(parseLegacyJourney(raw, source)), migrated: true };
    }
  }
  return { ir: parseIr(raw, source), migrated: false };
}

function slug(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "sem-nome";
}
