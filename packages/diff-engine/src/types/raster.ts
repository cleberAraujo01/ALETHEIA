/**
 * Imagem já decodificada.
 *
 * O motor não lê arquivo, não decodifica PNG e não fala com disco — quem
 * carrega a imagem é o shim. Manter o motor puro é o que permite rodá-lo
 * contra um corpus versionado, medir precisão e recall, e garantir que duas
 * execuções produzam o mesmo relatório (PA-12).
 */
export interface RasterImage {
  readonly width: number;
  readonly height: number;
  /** RGBA, 4 bytes por pixel, em ordem de linha. */
  readonly data: Uint8Array;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Imagens de uma execução, indexadas por `observationId`. */
export type RasterSet = ReadonlyMap<string, RasterImage>;
