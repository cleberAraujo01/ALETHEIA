import type { RasterImage, Rect } from "../types/raster.js";
import { compareRasters, type VisualComparisonOptions } from "../visual/compare.js";
import { DeltaBudget, type RawDelta } from "./types.js";

/**
 * Diferenciação visual — estágio 3, camada visual.
 *
 * Emite um delta por região alterada, nunca por pixel, e sempre com o
 * retângulo em coordenadas absolutas para que a triagem saiba onde olhar.
 */
export function diffVisual(
  observationId: string,
  base: RasterImage,
  head: RasterImage,
  masks: readonly Rect[],
  options: VisualComparisonOptions,
  budget: DeltaBudget,
): RawDelta[] {
  const out: RawDelta[] = [];
  const emit = (delta: RawDelta): void => {
    if (budget.take()) out.push(delta);
  };

  const comparison = compareRasters(base, head, { ...options, masks });

  if (comparison.dimensionsChanged) {
    emit({
      layer: "VISUAL",
      kind: "VISUAL_DIMENSIONS_CHANGED",
      observationId,
      path: "screenshot",
      before: `${base.width}×${base.height}`,
      after: `${head.width}×${head.height}`,
      facts: {
        baseWidth: base.width,
        baseHeight: base.height,
        headWidth: head.width,
        headHeight: head.height,
        // A comparação seguiu na interseção; dizer o quanto foi comparado
        // impede a leitura de que a página inteira foi verificada.
        comparedWidth: comparison.comparedWidth,
        comparedHeight: comparison.comparedHeight,
      },
    });
  }

  for (const region of comparison.regions) {
    emit({
      layer: "VISUAL",
      kind: "VISUAL_REGION_CHANGED",
      observationId,
      path: `screenshot @ ${region.x},${region.y} ${region.width}×${region.height}`,
      before: null,
      after: null,
      facts: {
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
        changedPixels: region.changedPixels,
        areaRatio: region.areaRatio,
        maskedRegions: masks.length,
      },
    });
  }

  return out;
}
