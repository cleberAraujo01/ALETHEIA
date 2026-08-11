import type { RasterImage, Rect } from "../types/raster.js";

/**
 * Comparação visual perceptual **por região** — §12.4.
 *
 * O erro clássico do diff visual é reportar pixel. Ninguém tria pixel: um
 * relatório com "48.219 pixels diferentes" não diz onde nem o quê, e o time
 * desliga a camada visual na primeira semana. Por isso o resultado aqui é uma
 * lista curta de retângulos com área e densidade.
 *
 * Ruídos que §12.4 manda suprimir nesta camada — antialiasing, renderização de
 * fonte, animação, conteúdo dinâmico — são tratados por três mecanismos, nesta
 * ordem:
 *
 *   1. Distância perceptual YIQ com limiar, em vez de igualdade de bytes.
 *      Diferença imperceptível ao olho não vira delta.
 *   2. Densidade mínima por célula. Antialiasing e hinting de fonte produzem
 *      pixels isolados nas bordas; uma célula só conta como alterada se tiver
 *      um número mínimo de pixels alterados.
 *   3. Máscaras declaradas na captura, para regiões sabidamente dinâmicas
 *      (carrossel, relógio, banner rotativo).
 */

export interface VisualComparisonOptions {
  /**
   * Limiar de distância perceptual, 0..1. HIPÓTESE: 0.1 é o default herdado da
   * literatura de diff perceptual (Yee) e da prática de mercado; ainda não foi
   * medido contra corpus real desta plataforma.
   */
  readonly colorThreshold: number;
  /** Lado da célula da grade, em pixels. */
  readonly cellSize: number;
  /** Pixels alterados que uma célula precisa ter para contar como alterada. */
  readonly minChangedPixelsPerCell: number;
  /** Células que uma região precisa ter para virar delta. */
  readonly minCellsPerRegion: number;
  readonly masks: readonly Rect[];
}

export const DEFAULT_VISUAL_OPTIONS: VisualComparisonOptions = {
  colorThreshold: 0.1,
  cellSize: 8,
  // 6 de 64 pixels: densidade suficiente para descartar borda de texto
  // reantialiasada e reter qualquer elemento que de fato mudou. HIPÓTESE.
  minChangedPixelsPerCell: 6,
  minCellsPerRegion: 2,
  masks: [],
};

export interface VisualRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly changedPixels: number;
  /** Fração da área comparada que a região ocupa, 0..1. */
  readonly areaRatio: number;
}

export interface VisualComparison {
  readonly regions: readonly VisualRegion[];
  readonly changedPixels: number;
  readonly comparedPixels: number;
  readonly dimensionsChanged: boolean;
  readonly comparedWidth: number;
  readonly comparedHeight: number;
}

/** Distância YIQ máxima entre dois pixels — usada para normalizar o limiar. */
const MAX_YIQ_DELTA = 35215;

export function compareRasters(
  base: RasterImage,
  head: RasterImage,
  options: VisualComparisonOptions = DEFAULT_VISUAL_OPTIONS,
): VisualComparison {
  // Dimensões diferentes não impedem a comparação: compara-se a interseção e
  // reporta-se a mudança de dimensão à parte. Recusar comparar seria perder
  // toda a informação por causa de uma barra de rolagem.
  const width = Math.min(base.width, head.width);
  const height = Math.min(base.height, head.height);
  const dimensionsChanged = base.width !== head.width || base.height !== head.height;

  const cols = Math.ceil(width / options.cellSize);
  const rows = Math.ceil(height / options.cellSize);
  const cellCounts = new Int32Array(Math.max(cols * rows, 0));
  const thresholdSquared = options.colorThreshold * options.colorThreshold * MAX_YIQ_DELTA;

  let changedPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (isMasked(x, y, options.masks)) continue;
      const delta = pixelDelta(base, head, x, y);
      if (delta <= thresholdSquared) continue;
      changedPixels += 1;
      const cell = Math.floor(y / options.cellSize) * cols + Math.floor(x / options.cellSize);
      const current = cellCounts[cell];
      if (current !== undefined) cellCounts[cell] = current + 1;
    }
  }

  const comparedPixels = width * height;
  const regions = clusterRegions(cellCounts, cols, rows, options, comparedPixels, width, height);

  return {
    regions,
    changedPixels,
    comparedPixels,
    dimensionsChanged,
    comparedWidth: width,
    comparedHeight: height,
  };
}

/**
 * Distância perceptual entre dois pixels no espaço YIQ.
 *
 * RGB puro trata uma variação de azul escuro como equivalente a uma variação
 * de verde claro; o olho não. YIQ separa luminância de crominância e pondera
 * cada uma pelo quanto de fato é percebida.
 */
function pixelDelta(base: RasterImage, head: RasterImage, x: number, y: number): number {
  const baseOffset = (y * base.width + x) * 4;
  const headOffset = (y * head.width + x) * 4;

  const [br, bg, bb] = blendOnWhite(base.data, baseOffset);
  const [hr, hg, hb] = blendOnWhite(head.data, headOffset);

  const y1 = 0.29889531 * br + 0.58662247 * bg + 0.11448223 * bb;
  const y2 = 0.29889531 * hr + 0.58662247 * hg + 0.11448223 * hb;
  const i1 = 0.59597799 * br - 0.2741761 * bg - 0.32180189 * bb;
  const i2 = 0.59597799 * hr - 0.2741761 * hg - 0.32180189 * hb;
  const q1 = 0.21147017 * br - 0.52261711 * bg + 0.31114694 * bb;
  const q2 = 0.21147017 * hr - 0.52261711 * hg + 0.31114694 * hb;

  const dy = y1 - y2;
  const di = i1 - i2;
  const dq = q1 - q2;

  return 0.5053 * dy * dy + 0.299 * di * di + 0.1957 * dq * dq;
}

/** Compõe sobre branco: transparência precisa virar cor antes de comparar. */
function blendOnWhite(data: Uint8Array, offset: number): [number, number, number] {
  const alpha = (data[offset + 3] ?? 255) / 255;
  const r = data[offset] ?? 0;
  const g = data[offset + 1] ?? 0;
  const b = data[offset + 2] ?? 0;
  if (alpha === 1) return [r, g, b];
  return [255 + (r - 255) * alpha, 255 + (g - 255) * alpha, 255 + (b - 255) * alpha];
}

function isMasked(x: number, y: number, masks: readonly Rect[]): boolean {
  for (const mask of masks) {
    if (x >= mask.x && x < mask.x + mask.width && y >= mask.y && y < mask.y + mask.height) {
      return true;
    }
  }
  return false;
}

/**
 * Agrupa células alteradas em regiões conexas (vizinhança 4). Varredura em
 * ordem de linha e ordenação final estável mantêm o resultado determinístico.
 */
function clusterRegions(
  cellCounts: Int32Array,
  cols: number,
  rows: number,
  options: VisualComparisonOptions,
  comparedPixels: number,
  width: number,
  height: number,
): VisualRegion[] {
  const active = new Uint8Array(cols * rows);
  for (let index = 0; index < cellCounts.length; index += 1) {
    active[index] = (cellCounts[index] ?? 0) >= options.minChangedPixelsPerCell ? 1 : 0;
  }

  const visited = new Uint8Array(cols * rows);
  const regions: VisualRegion[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const start = row * cols + col;
      if (active[start] !== 1 || visited[start] === 1) continue;

      const queue = [start];
      visited[start] = 1;
      let cells = 0;
      let changedPixels = 0;
      let minCol = col;
      let maxCol = col;
      let minRow = row;
      let maxRow = row;

      while (queue.length > 0) {
        const current = queue.pop();
        if (current === undefined) continue;
        const currentRow = Math.floor(current / cols);
        const currentCol = current % cols;

        cells += 1;
        changedPixels += cellCounts[current] ?? 0;
        if (currentCol < minCol) minCol = currentCol;
        if (currentCol > maxCol) maxCol = currentCol;
        if (currentRow < minRow) minRow = currentRow;
        if (currentRow > maxRow) maxRow = currentRow;

        for (const [dc, dr] of NEIGHBOURS) {
          const nextCol = currentCol + dc;
          const nextRow = currentRow + dr;
          if (nextCol < 0 || nextCol >= cols || nextRow < 0 || nextRow >= rows) continue;
          const next = nextRow * cols + nextCol;
          if (active[next] !== 1 || visited[next] === 1) continue;
          visited[next] = 1;
          queue.push(next);
        }
      }

      if (cells < options.minCellsPerRegion) continue;

      const x = minCol * options.cellSize;
      const y = minRow * options.cellSize;
      const regionWidth = Math.min((maxCol + 1) * options.cellSize, width) - x;
      const regionHeight = Math.min((maxRow + 1) * options.cellSize, height) - y;

      regions.push({
        x,
        y,
        width: regionWidth,
        height: regionHeight,
        changedPixels,
        areaRatio:
          comparedPixels === 0
            ? 0
            : Number(((regionWidth * regionHeight) / comparedPixels).toFixed(6)),
      });
    }
  }

  return regions.sort(
    (a, b) => b.changedPixels - a.changedPixels || a.y - b.y || a.x - b.x,
  );
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
