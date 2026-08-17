import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import type { CapabilityCatalog } from "./executor/index.js";
import { parseCapabilityYaml } from "./parse.js";
import type { CapabilitySpec } from "./spec.js";
import { validateCapability, type ValidationResult } from "./validate.js";

/**
 * Catálogo = todos os `.yaml`/`.yml` de um diretório (recursivo) ou um arquivo.
 * Capability vive em Git, ao lado do código do cliente, e é revisada em PR —
 * o catálogo é só a leitura desse diretório.
 */
export function loadCatalog(path: string): CapabilityCatalog {
  const files = collectYaml(path);
  const specs: CapabilitySpec[] = files.map((file) =>
    parseCapabilityYaml(readFileSync(file, "utf8"), file),
  );
  return { specs };
}

export interface CatalogReport {
  readonly file: string;
  readonly spec: CapabilitySpec | null;
  readonly validation: ValidationResult | null;
  readonly parseError: string | null;
}

/** Para o `capabilities:validate`: cada arquivo, seu resultado, sem lançar. */
export function auditCatalog(path: string): CatalogReport[] {
  return collectYaml(path).map((file): CatalogReport => {
    try {
      const spec = parseCapabilityYaml(readFileSync(file, "utf8"), file);
      return {
        file: relative(process.cwd(), file),
        spec,
        validation: validateCapability(spec),
        parseError: null,
      };
    } catch (error) {
      return {
        file: relative(process.cwd(), file),
        spec: null,
        validation: null,
        parseError: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

function collectYaml(path: string): string[] {
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.ya?ml$/.test(entry)) out.push(full);
    }
  };
  walk(path);
  return out;
}
