import type { DatabaseObservation } from "../types/capture.js";

import { type DeltaBudget, truncateValue, type RawDelta } from "./types.js";

/**
 * Diferenciação de banco — a camada que a §21.3 chama de diferencial da cunha:
 * "sem ele, a detecção de regressão é convencional. Com ele, a demo mostra
 * divergência entre UI, API e persistência".
 *
 * O que se compara é o RESULTADO de uma capability READ (§14) executada no
 * mesmo ponto da jornada contra a base e contra o head. Nunca a tabela
 * inteira: só o que a capability aprovada devolve, já mascarado na borda.
 *
 * ALINHAMENTO POR IDENTIDADE, DECLARADA. A capability diz quais colunas
 * identificam a linha (`keyColumns`); as linhas se casam por elas. Sem
 * `keyColumns`, casa por posição — e o delta carrega `alignedBy: "position"`,
 * para ninguém confundir "a segunda linha mudou" com "o pedido 42 mudou".
 *
 * COLUNAS VOLÁTEIS FICAM DE FORA, e ficam de fora POR DECLARAÇÃO na capability
 * (`created_at`, sequences — §12.4). Não há heurística de "parece timestamp":
 * o autor da capability sabe o que muda a cada execução, e o relatório conta
 * quantas colunas ignorou.
 *
 * SONDA QUE FALHOU DE UM LADO SÓ É DELTA, NÃO SILÊNCIO. Se a capability rodou
 * na base e falhou no head, o mais provável é que a mudança quebrou a consulta
 * (coluna renomeada, tabela dropada) — evidência de primeira ordem. Vira
 * `DB_PROBE_FAILED` com o motivo dos dois lados.
 */
export function diffDatabase(
  observationId: string,
  base: readonly DatabaseObservation[],
  head: readonly DatabaseObservation[],
  budget: DeltaBudget,
): RawDelta[] {
  const deltas: RawDelta[] = [];
  const emit = (delta: RawDelta): void => {
    if (budget.take()) deltas.push(delta);
  };

  const baseByProbe = new Map(base.map((probe) => [probeKey(probe), probe]));
  const headByProbe = new Map(head.map((probe) => [probeKey(probe), probe]));
  const keys = [...new Set([...baseByProbe.keys(), ...headByProbe.keys()])].sort();

  for (const key of keys) {
    const before = baseByProbe.get(key);
    const after = headByProbe.get(key);
    const path = `db:${key}`;

    if (before === undefined || after === undefined) {
      emit({
        layer: "DATABASE",
        kind: "DB_PROBE_MISSING",
        observationId,
        path,
        before: before === undefined ? null : "executada",
        after: after === undefined ? null : "executada",
        facts: {
          capability: (before ?? after)?.capability ?? key,
          side: before === undefined ? "base" : "head",
        },
      });
      continue;
    }

    if (before.error !== null || after.error !== null) {
      emit({
        layer: "DATABASE",
        kind: "DB_PROBE_FAILED",
        observationId,
        path,
        before: before.error,
        after: after.error,
        facts: {
          capability: before.capability,
          failedInBase: before.error !== null,
          failedInHead: after.error !== null,
        },
      });
      continue;
    }

    diffProbe(observationId, path, before, after, emit);
  }
  return deltas;
}

function diffProbe(
  observationId: string,
  path: string,
  before: DatabaseObservation,
  after: DatabaseObservation,
  emit: (delta: RawDelta) => void,
): void {
  const volatile = new Set([...before.volatileColumns, ...after.volatileColumns]);
  const keyColumns = before.keyColumns.length > 0 ? before.keyColumns : after.keyColumns;
  const alignedBy = keyColumns.length > 0 ? "key" : "position";
  const columns = [...new Set([...before.columns, ...after.columns])];
  const compared = columns.filter((column) => !volatile.has(column));

  const baseRows = indexRows(before, keyColumns);
  const headRows = indexRows(after, keyColumns);

  if (before.rowCount !== after.rowCount) {
    emit({
      layer: "DATABASE",
      kind: "DB_ROWCOUNT_CHANGED",
      observationId,
      path,
      before: String(before.rowCount),
      after: String(after.rowCount),
      facts: {
        capability: before.capability,
        alignedBy,
        truncated: before.truncated || after.truncated,
      },
    });
  }

  for (const [rowKey, baseRow] of baseRows) {
    const headRow = headRows.get(rowKey);
    if (headRow === undefined) {
      emit({
        layer: "DATABASE",
        kind: "DB_ROW_REMOVED",
        observationId,
        path: `${path}/${rowKey}`,
        before: truncateValue(summarize(before.columns, baseRow)),
        after: null,
        facts: { capability: before.capability, alignedBy },
      });
      continue;
    }
    for (const column of compared) {
      const baseValue = cell(before.columns, baseRow, column);
      const headValue = cell(after.columns, headRow, column);
      if (baseValue === headValue) continue;
      emit({
        layer: "DATABASE",
        kind: "DB_FIELD_CHANGED",
        observationId,
        path: `${path}/${rowKey}/${column}`,
        before: truncateValue(baseValue),
        after: truncateValue(headValue),
        facts: {
          capability: before.capability,
          column,
          alignedBy,
          masked: before.maskedColumns.includes(column) || after.maskedColumns.includes(column),
        },
      });
    }
  }
  for (const [rowKey, headRow] of headRows) {
    if (baseRows.has(rowKey)) continue;
    emit({
      layer: "DATABASE",
      kind: "DB_ROW_ADDED",
      observationId,
      path: `${path}/${rowKey}`,
      before: null,
      after: truncateValue(summarize(after.columns, headRow)),
      facts: { capability: after.capability, alignedBy },
    });
  }
}

/** Identidade da sonda: capability + parâmetros, canônicos. */
function probeKey(probe: DatabaseObservation): string {
  const params = Object.keys(probe.params)
    .sort()
    .map((key) => `${key}=${String(probe.params[key])}`)
    .join("&");
  return params.length > 0 ? `${probe.capability}?${params}` : probe.capability;
}

function indexRows(
  probe: DatabaseObservation,
  keyColumns: readonly string[],
): Map<string, readonly (string | number | boolean | null)[]> {
  const out = new Map<string, readonly (string | number | boolean | null)[]>();
  const seen = new Map<string, number>();
  probe.rows.forEach((row, index) => {
    let key =
      keyColumns.length > 0
        ? keyColumns
            .map((column) => `${column}=${String(cell(probe.columns, row, column))}`)
            .join(",")
        : `#${index}`;
    // Chave repetida (capability sem chave única de verdade): desambigua por
    // ordinal, e o caminho mostra que houve repetição.
    const collisions = seen.get(key) ?? 0;
    seen.set(key, collisions + 1);
    if (collisions > 0) key = `${key}[${collisions}]`;
    out.set(key, row);
  });
  return out;
}

function cell(
  columns: readonly string[],
  row: readonly (string | number | boolean | null)[],
  column: string,
): string | null {
  const index = columns.indexOf(column);
  if (index === -1) return null;
  const value = row[index];
  return value === null || value === undefined ? null : String(value);
}

function summarize(
  columns: readonly string[],
  row: readonly (string | number | boolean | null)[],
): string {
  return columns.map((column, index) => `${column}=${String(row[index] ?? "null")}`).join(" ");
}
