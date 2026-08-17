import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { PlatformError, type PlatformErrorCode } from "@aletheia/shared";

/**
 * Leitura e escrita de JSON com erro canônico. Toda falha aqui é de plataforma
 * (RN-CI-005): arquivo ilegível ou malformado nunca é culpa do código do
 * cliente e nunca pode reprovar o PR dele.
 */
export async function readJson(
  path: string,
  invalidCode: PlatformErrorCode = "CAPTURE_INVALID",
): Promise<unknown> {
  const absolute = resolve(path);
  let content: string;
  try {
    content = await readFile(absolute, "utf8");
  } catch (cause) {
    throw new PlatformError("CAPTURE_UNREADABLE", { path: absolute }, cause);
  }
  try {
    return JSON.parse(content);
  } catch (cause) {
    throw new PlatformError(invalidCode, { path: absolute, reason: "JSON inválido" }, cause);
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  const target = resolve(path);
  try {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } catch (cause) {
    throw new PlatformError("REPORT_WRITE_FAILED", { path: target }, cause);
  }
}
