/**
 * Mascaramento de segredo na borda da captura (PA-09).
 *
 * Um valor vindo de `{ secretRef }` foi digitado num campo; a partir daí ele
 * pode reaparecer no corpo do POST, na URL, num eco do console ou num atributo
 * do DOM. Nenhum desses lugares pode guardá-lo: a captura vira artefato,
 * artefato vira anexo de PR. A troca por `<secret>` é feita em TUDO que a
 * captura registra, por igualdade de string — barato, determinístico e
 * suficiente para o valor que nós mesmos digitamos.
 */
export function redactDeep<T>(value: T, secrets: readonly string[]): T {
  if (secrets.length === 0) return value;
  return walk(value, secrets) as T;
}

function walk(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") return redactString(value, secrets);
  if (Array.isArray(value)) return value.map((entry) => walk(entry, secrets));
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) out[key] = walk(entry, secrets);
    return out;
  }
  return value;
}

export function redactString(value: string, secrets: readonly string[]): string {
  let out = value;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    out = out.split(secret).join("<secret>");
    const encoded = encodeURIComponent(secret);
    if (encoded !== secret) out = out.split(encoded).join("<secret>");
  }
  return out;
}
