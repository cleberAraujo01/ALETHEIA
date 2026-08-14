import { describe, expect, it } from "vitest";

import type { RasterImage } from "../types/raster.js";

import { DEFAULT_VISUAL_OPTIONS, compareRasters } from "./compare.js";

function blank(width: number, height: number): RasterImage {
  const data = new Uint8Array(width * height * 4).fill(255);
  return { width, height, data };
}

function paint(
  image: RasterImage,
  rect: { x: number; y: number; width: number; height: number },
  color: [number, number, number],
): RasterImage {
  const data = new Uint8Array(image.data);
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = 255;
    }
  }
  return { ...image, data };
}

const BLACK: [number, number, number] = [0, 0, 0];

describe("comparação visual por região", () => {
  it("imagens idênticas não produzem região alguma", () => {
    const image = paint(blank(64, 64), { x: 8, y: 8, width: 16, height: 16 }, BLACK);
    const result = compareRasters(image, image);

    expect(result.changedPixels).toBe(0);
    expect(result.regions).toEqual([]);
    expect(result.dimensionsChanged).toBe(false);
  });

  it("pixels isolados não viram delta — é o ruído de antialiasing", () => {
    // Dois pixels soltos, como uma borda de texto reantialiasada.
    const base = blank(64, 64);
    const head = paint(base, { x: 30, y: 30, width: 1, height: 1 }, BLACK);

    const result = compareRasters(base, paint(head, { x: 40, y: 12, width: 1, height: 1 }, BLACK));

    expect(result.changedPixels).toBe(2);
    // Detectados na contagem, mas sem densidade para virar região reportável.
    expect(result.regions).toEqual([]);
  });

  it("um bloco alterado vira uma região com retângulo correto", () => {
    const base = blank(64, 64);
    const head = paint(base, { x: 16, y: 24, width: 24, height: 16 }, BLACK);

    const result = compareRasters(base, head);

    expect(result.regions).toHaveLength(1);
    const region = result.regions[0];
    expect(region?.x).toBeLessThanOrEqual(16);
    expect(region?.y).toBeLessThanOrEqual(24);
    expect((region?.x ?? 0) + (region?.width ?? 0)).toBeGreaterThanOrEqual(40);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeGreaterThanOrEqual(40);
    expect(region?.changedPixels).toBe(24 * 16);
  });

  it("regiões separadas não são fundidas numa só", () => {
    const base = blank(96, 96);
    let head = paint(base, { x: 4, y: 4, width: 16, height: 16 }, BLACK);
    head = paint(head, { x: 64, y: 64, width: 16, height: 16 }, BLACK);

    expect(compareRasters(base, head).regions).toHaveLength(2);
  });

  it("máscara declarada na captura remove a região da comparação", () => {
    const base = blank(64, 64);
    const head = paint(base, { x: 16, y: 16, width: 24, height: 24 }, BLACK);

    const masked = compareRasters(base, head, {
      ...DEFAULT_VISUAL_OPTIONS,
      masks: [{ x: 8, y: 8, width: 48, height: 48 }],
    });

    expect(masked.changedPixels).toBe(0);
    expect(masked.regions).toEqual([]);
  });

  it("dimensões diferentes são reportadas e a interseção ainda é comparada", () => {
    const base = paint(blank(64, 64), { x: 8, y: 8, width: 16, height: 16 }, BLACK);
    const head = blank(64, 96);

    const result = compareRasters(base, head);

    expect(result.dimensionsChanged).toBe(true);
    expect(result.comparedHeight).toBe(64);
    expect(result.regions).toHaveLength(1);
  });

  it("diferença imperceptível fica abaixo do limiar", () => {
    const base = blank(64, 64);
    // Branco puro contra quase-branco: variação real de bytes, invisível ao olho.
    const head = paint(base, { x: 0, y: 0, width: 64, height: 64 }, [254, 254, 254]);

    expect(compareRasters(base, head).regions).toEqual([]);
  });

  it("é determinístico", () => {
    const base = blank(64, 64);
    const head = paint(base, { x: 10, y: 10, width: 20, height: 20 }, BLACK);

    expect(JSON.stringify(compareRasters(base, head))).toBe(
      JSON.stringify(compareRasters(base, head)),
    );
  });
});
