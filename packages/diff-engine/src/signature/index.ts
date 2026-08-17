import type { RawDelta } from "../diff/types.js";
import type { DeltaKind, DeltaLayer } from "../types/delta.js";

/**
 * Assinatura de um delta — "mesmo lugar, mesmo tipo de mudança", ignorando o
 * nome do nó e a página em que ele apareceu.
 *
 * É a noção compartilhada por dois consumidores que precisam concordar entre si:
 * o AGRUPAMENTO do relatório (deltas que provavelmente têm a mesma causa) e a
 * SUPRESSÃO APRENDIDA (o que uma regra por projeto casa). Se um grupo do
 * relatório e uma regra de supressão usassem chaves diferentes, o humano
 * rotularia um grupo e a regra cobriria outro.
 *
 * Deliberadamente pequena: camada, tipo e esqueleto de caminho, comparados por
 * igualdade. Alargar (prefixo, curinga) é decisão que ainda não tem caso que a
 * peça; quando tiver, entra com o caso.
 */
export interface DeltaSignature {
  readonly layer: DeltaLayer;
  readonly kind: DeltaKind;
  /** Ver `pathSkeleton`. Para camadas que não são DOM, é o próprio caminho. */
  readonly pathSkeleton: string;
}

/**
 * Esqueleto de um caminho de identidade do DOM: a estrutura, sem os nomes.
 *
 * `body > nav[role=navigation "Rodapé"] > ul > li[role=listitem "Apoie o clube"]`
 * vira `body > nav[role=navigation] > ul > li[role=listitem]`. Ficam tag, id,
 * `data-testid`, papel, ordinal de desambiguação e o sufixo `@atributo` — tudo
 * que descreve ONDE, nada que descreva O QUÊ. É deliberadamente uma função de
 * string, aplicada igual dos dois lados; nome acessível que contenha aspas sai
 * mais grosseiro do que o ideal, e isso é aceito porque continua determinístico.
 */
export function pathSkeleton(layer: DeltaLayer, path: string): string {
  if (layer !== "DOM") return path;
  return path
    .replace(/\["[^"]*"\]/g, "[*]") // tag["nome"]           → tag[*]
    .replace(/ "[^"]*"/g, ""); //      tag[role=x "nome"]     → tag[role=x]
}

export function signatureOf(delta: Pick<RawDelta, "layer" | "kind" | "path">): DeltaSignature {
  return {
    layer: delta.layer,
    kind: delta.kind,
    pathSkeleton: pathSkeleton(delta.layer, delta.path),
  };
}

export function signatureKey(signature: DeltaSignature): string {
  return `${signature.layer} ${signature.kind} ${signature.pathSkeleton}`;
}

export function matchesSignature(
  signature: DeltaSignature,
  delta: Pick<RawDelta, "layer" | "kind" | "path">,
): boolean {
  return (
    delta.layer === signature.layer &&
    delta.kind === signature.kind &&
    pathSkeleton(delta.layer, delta.path) === signature.pathSkeleton
  );
}
