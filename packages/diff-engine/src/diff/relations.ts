import type { DomNode, RelationSpec } from "../types/capture.js";

import type { DeltaBudget, RawDelta } from "./types.js";

/**
 * Relações metamórficas (O3) — verificadas sobre o DOM capturado, em cada
 * lado, de forma determinística.
 *
 * O problema que resolve é o do oráculo na forma mais nua (§1 do CLAUDE.md;
 * D5 do `aletheia-demo`, §11.7 da medição da Fase 1): o total do carrinho
 * passa de `R$ 382,26` para `R$ 271,84`, a tela renderiza, a rede não muda,
 * e texto que muda é MEDIUM — o motor não sabe se é o valor errado ou o
 * novo. Uma relação declarada pela aplicação ("total = soma das partes")
 * dá ao motor a única coisa que lhe faltava: uma verdade contra a qual
 * julgar, sem modelo, sem banco, sem requisito.
 *
 * O contrato é estreito de propósito: as partes e o total são atributos
 * `data-*` de valor inteiro, declarados pela aplicação. Nada é lido de texto
 * formatado. Se o atributo não está lá, a relação é INAVALIÁVEL — e isso
 * aparece no relatório como lacuna, nunca como regressão.
 *
 * A comparação continua diferencial: violada no head E válida na base é
 * regressão; violada nos dois lados é defeito pré-existente, visível e não
 * bloqueante, porque este oráculo não atribui ao PR o que já estava errado.
 */
export function diffRelations(
  observationId: string,
  relations: readonly RelationSpec[],
  baseDom: DomNode | null,
  headDom: DomNode | null,
  budget: DeltaBudget,
): RawDelta[] {
  const out: RawDelta[] = [];
  const emit = (delta: RawDelta): void => {
    if (budget.take()) out.push(delta);
  };

  for (const relation of relations) {
    const path = `relation:${relation.id}`;
    const head = headDom === null ? null : evaluate(relation, headDom);
    const base = baseDom === null ? null : evaluate(relation, baseDom);

    if (head === null || "reason" in head) {
      emit({
        layer: "DOM",
        kind: "RELATION_UNEVALUABLE",
        observationId,
        path,
        before: base === null || "reason" in base ? null : describe(base),
        after: null,
        facts: {
          relation: relation.id,
          kind: relation.kind,
          reason: head === null ? "sem DOM no head" : head.reason,
          parts: relation.parts,
          total: relation.total,
        },
      });
      continue;
    }
    if (head.holds) continue;

    const alreadyBroken = base !== null && !("reason" in base) && !base.holds;
    emit({
      layer: "DOM",
      kind: "RELATION_VIOLATED",
      observationId,
      path,
      before: base === null || "reason" in base ? null : describe(base),
      after: describe(head),
      facts: {
        relation: relation.id,
        kind: relation.kind,
        parts: relation.parts,
        total: relation.total,
        headSum: head.sum,
        headTotal: head.total,
        headParts: head.count,
        alreadyBroken,
      },
    });
  }

  return out;
}

interface Evaluation {
  readonly holds: boolean;
  readonly sum: number;
  readonly total: number;
  readonly count: number;
}

/** Soma os inteiros do atributo `parts` e compara com o único `total`. */
export function evaluate(
  relation: RelationSpec,
  dom: DomNode,
): Evaluation | { readonly reason: string } {
  const parts: number[] = [];
  const totals: number[] = [];
  const malformed: string[] = [];
  walk(dom, (node) => {
    const part = node.attributes[relation.parts];
    if (part !== undefined) {
      const value = integerOf(part);
      if (value === null) malformed.push(`${relation.parts}="${part}" não é inteiro`);
      else parts.push(value);
    }
    const total = node.attributes[relation.total];
    if (total !== undefined) {
      const value = integerOf(total);
      if (value === null) malformed.push(`${relation.total}="${total}" não é inteiro`);
      else totals.push(value);
    }
  });
  const firstMalformed = malformed[0];
  if (firstMalformed !== undefined) return { reason: firstMalformed };
  if (totals.length !== 1) {
    return {
      reason:
        totals.length === 0
          ? `nenhum elemento com ${relation.total}`
          : `${totals.length} elementos com ${relation.total}; esperado exatamente um`,
    };
  }
  if (parts.length === 0) return { reason: `nenhum elemento com ${relation.parts}` };
  const sum = parts.reduce((a, b) => a + b, 0);
  const total = totals[0] as number;
  return { holds: sum === total, sum, total, count: parts.length };
}

function walk(node: DomNode, visit: (node: DomNode) => void): void {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

function integerOf(raw: string): number | null {
  return /^-?\d+$/.test(raw.trim()) ? Number(raw.trim()) : null;
}

function describe(evaluation: Evaluation): string {
  return `soma(${evaluation.count} partes)=${evaluation.sum} · total=${evaluation.total} · ${evaluation.holds ? "vale" : "VIOLADA"}`;
}
