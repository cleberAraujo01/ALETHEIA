import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { Capture, RasterImage } from "@aletheia/diff-engine";
import { PlatformError } from "@aletheia/shared";
import { PNG } from "pngjs";

/**
 * Carrega e decodifica os screenshots de uma captura.
 *
 * Fica no shim de propósito: o Diff Engine não abre arquivo nem decodifica
 * imagem. Ele recebe raster pronto e continua sendo uma função pura do par de
 * capturas — que é o que permite rodá-lo contra corpus e medir precisão.
 */
export async function loadRasters(
  capture: Capture,
  captureFilePath: string,
): Promise<Map<string, RasterImage>> {
  const rasters = new Map<string, RasterImage>();
  const baseDirectory = dirname(resolve(captureFilePath));

  for (const observation of capture.observations) {
    if (observation.screenshot === null) continue;
    const file = resolve(baseDirectory, observation.screenshot.path);

    let buffer: Buffer;
    try {
      buffer = await readFile(file);
    } catch (cause) {
      // Screenshot referenciado e ausente é falha nossa de artefato, não
      // veredito sobre o cliente (RN-CI-005).
      throw new PlatformError(
        "CAPTURE_UNREADABLE",
        { path: file, observationId: observation.observationId },
        cause,
      );
    }

    const png = PNG.sync.read(buffer);
    rasters.set(observation.observationId, {
      width: png.width,
      height: png.height,
      data: new Uint8Array(png.data),
    });
  }

  return rasters;
}
