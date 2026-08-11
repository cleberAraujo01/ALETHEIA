import { alignByKeys } from "../align/generic.js";
import { describeNode, type NormalizedDomNode } from "../normalize/dom.js";
import { DeltaBudget, truncateValue, type RawDelta } from "./types.js";

/**
 * Diferenciação de DOM — estágio 3 do pipeline.
 *
 * Duas decisões que determinam a taxa de ruído:
 *
 * 1. **Poda por hash de subárvore**: subárvores idênticas não são percorridas.
 *    Além de performance, evita que uma diferença no pai gere deltas em todos
 *    os descendentes.
 * 2. **Remoção não desce**: um nó removido produz UM delta, não um por
 *    descendente. O tamanho da subárvore vai como fato, para a pontuação saber
 *    que remover um `<div>` com 300 nós não é o mesmo que remover um `<span>`.
 */
export function diffDom(
  observationId: string,
  base: NormalizedDomNode,
  head: NormalizedDomNode,
  budget: DeltaBudget,
): RawDelta[] {
  const deltas: RawDelta[] = [];
  walk(observationId, base, head, describeNode(base), deltas, budget);
  return deltas;
}

function walk(
  observationId: string,
  base: NormalizedDomNode,
  head: NormalizedDomNode,
  path: string,
  out: RawDelta[],
  budget: DeltaBudget,
): void {
  if (base.subtreeHash === head.subtreeHash) return;
  if (budget.exhausted) return;

  const emit = (delta: RawDelta): void => {
    if (budget.take()) out.push(delta);
  };

  if (base.role !== head.role) {
    emit({
      layer: "DOM",
      kind: "DOM_ROLE_CHANGED",
      observationId,
      path,
      before: base.role,
      after: head.role,
      facts: { tag: base.tag },
    });
  }

  if (base.accessibleName !== head.accessibleName) {
    emit({
      layer: "DOM",
      kind: "DOM_ACCESSIBLE_NAME_CHANGED",
      observationId,
      path,
      before: truncateValue(base.accessibleName),
      after: truncateValue(head.accessibleName),
      facts: { tag: base.tag },
    });
  }

  if (base.text !== head.text) {
    emit({
      layer: "DOM",
      kind: "DOM_TEXT_CHANGED",
      observationId,
      path,
      before: truncateValue(base.text),
      after: truncateValue(head.text),
      facts: { tag: base.tag },
    });
  }

  diffAttributes(observationId, base, head, path, emit);

  const alignment = alignByKeys(base.children, head.children, [
    (node) => node.strongKey,
    (node) => node.weakKey,
    // Última passada: mesmo tipo de elemento, casado por ordem. Só alcança
    // nós que perderam toda identidade semântica entre as duas builds.
    (node) => node.tag,
  ]);

  // Desambiguação é por lista de irmãos, separadamente em base e head. Contar
  // as duas juntas faria um elemento presente nos dois lados parecer duplicado
  // e ganhar um ordinal que não existe.
  const baseLabels = disambiguate(base.children);
  const headLabels = disambiguate(head.children);

  for (const { item, index } of alignment.removed) {
    emit({
      layer: "DOM",
      kind: "DOM_NODE_REMOVED",
      observationId,
      path: `${path} > ${baseLabels.get(item) ?? describeNode(item)}`,
      before: truncateValue(summarize(item)),
      after: null,
      facts: { tag: item.tag, subtreeSize: item.subtreeSize, baseIndex: index },
    });
  }

  for (const { item, index } of alignment.added) {
    emit({
      layer: "DOM",
      kind: "DOM_NODE_ADDED",
      observationId,
      path: `${path} > ${headLabels.get(item) ?? describeNode(item)}`,
      before: null,
      after: truncateValue(summarize(item)),
      facts: { tag: item.tag, subtreeSize: item.subtreeSize, headIndex: index },
    });
  }

  if (alignment.reordered) {
    emit({
      layer: "DOM",
      kind: "DOM_CHILDREN_REORDERED",
      observationId,
      path,
      before: null,
      after: null,
      facts: { tag: base.tag, childCount: alignment.matched.length },
    });
  }

  for (const pair of alignment.matched) {
    walk(
      observationId,
      pair.base,
      pair.head,
      `${path} > ${baseLabels.get(pair.base) ?? describeNode(pair.base)}`,
      out,
      budget,
    );
  }
}

function diffAttributes(
  observationId: string,
  base: NormalizedDomNode,
  head: NormalizedDomNode,
  path: string,
  emit: (delta: RawDelta) => void,
): void {
  const names = new Set([...Object.keys(base.attributes), ...Object.keys(head.attributes)]);
  for (const name of [...names].sort()) {
    const before = base.attributes[name];
    const after = head.attributes[name];
    if (before === after) continue;

    if (before === undefined) {
      emit({
        layer: "DOM",
        kind: "DOM_ATTRIBUTE_ADDED",
        observationId,
        path: `${path}@${name}`,
        before: null,
        after: truncateValue(after ?? null),
        facts: { tag: base.tag, attribute: name },
      });
      continue;
    }
    if (after === undefined) {
      emit({
        layer: "DOM",
        kind: "DOM_ATTRIBUTE_REMOVED",
        observationId,
        path: `${path}@${name}`,
        before: truncateValue(before),
        after: null,
        facts: { tag: base.tag, attribute: name },
      });
      continue;
    }
    emit({
      layer: "DOM",
      kind: "DOM_ATTRIBUTE_CHANGED",
      observationId,
      path: `${path}@${name}`,
      before: truncateValue(before),
      after: truncateValue(after),
      facts: { tag: base.tag, attribute: name },
    });
  }
}

/**
 * Quando irmãos têm a mesma descrição legível (três `<li>` sem testid, por
 * exemplo), o caminho ganha um ordinal. Sem isso, o relatório aponta três
 * deltas para o mesmo endereço e ninguém consegue triar.
 */
function disambiguate(nodes: readonly NormalizedDomNode[]): Map<NormalizedDomNode, string> {
  const seen = new Map<string, number>();
  const labels = new Map<NormalizedDomNode, string>();
  const counts = new Map<string, number>();

  for (const node of nodes) {
    const label = describeNode(node);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  for (const node of nodes) {
    const label = describeNode(node);
    if ((counts.get(label) ?? 0) <= 1) {
      labels.set(node, label);
      continue;
    }
    const ordinal = seen.get(label) ?? 0;
    seen.set(label, ordinal + 1);
    labels.set(node, `${label}[${ordinal}]`);
  }
  return labels;
}

/** Resumo curto de uma subárvore, para o campo `before`/`after` do relatório. */
function summarize(node: NormalizedDomNode): string {
  const parts: string[] = [];
  const collect = (current: NormalizedDomNode): void => {
    if (current.text !== null) parts.push(current.text);
    for (const child of current.children) {
      if (parts.join(" ").length > MAX_SUMMARY_SOURCE) return;
      collect(child);
    }
  };
  collect(node);
  const text = parts.join(" ").trim();
  return text.length > 0 ? `${describeNode(node)} :: ${text}` : describeNode(node);
}

const MAX_SUMMARY_SOURCE = 400;
