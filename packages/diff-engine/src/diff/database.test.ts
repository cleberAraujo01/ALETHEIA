import { describe, expect, it } from "vitest";

import type { DatabaseObservation } from "../types/capture.js";

import { diffDatabase } from "./database.js";
import { DeltaBudget } from "./types.js";

const probe = (overrides: Partial<DatabaseObservation> = {}): DatabaseObservation => ({
  capability: "order.getDiscount",
  params: { orderId: 42 },
  columns: ["id", "discount_pct", "total_cents", "created_at"],
  rows: [[42, 15, 10000, "2026-01-01"]],
  rowCount: 1,
  truncated: false,
  keyColumns: ["id"],
  volatileColumns: ["created_at"],
  maskedColumns: [],
  durationMs: 3,
  error: null,
  ...overrides,
});

const run = (base: DatabaseObservation[], head: DatabaseObservation[]) =>
  diffDatabase("checkout", base, head, new DeltaBudget(100));

describe("diff de banco", () => {
  it("nada muda, nada sai — inclusive quando só a coluna volátil difere", () => {
    expect(run([probe()], [probe({ rows: [[42, 15, 10000, "2026-01-02"]] })])).toEqual([]);
  });

  it("valor de campo mudou: delta por coluna, alinhado pela chave declarada", () => {
    const deltas = run([probe()], [probe({ rows: [[42, 10, 10000, "2026-01-01"]] })]);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({
      layer: "DATABASE",
      kind: "DB_FIELD_CHANGED",
      path: "db:order.getDiscount?orderId=42/id=42/discount_pct",
      before: "15",
      after: "10",
      facts: {
        capability: "order.getDiscount",
        column: "discount_pct",
        alignedBy: "key",
        masked: false,
      },
    });
  });

  it("linha que some e linha que aparece, mais a contagem", () => {
    const deltas = run(
      [
        probe({
          rows: [
            [1, 15, 1, "x"],
            [2, 10, 2, "x"],
          ],
          rowCount: 2,
        }),
      ],
      [
        probe({
          rows: [
            [1, 15, 1, "x"],
            [3, 5, 3, "x"],
          ],
          rowCount: 2,
        }),
      ],
    );
    expect(deltas.map((delta) => delta.kind).sort()).toEqual(["DB_ROW_ADDED", "DB_ROW_REMOVED"]);
    const rowcount = run(
      [probe({ rows: [[1, 15, 1, "x"]], rowCount: 1 })],
      [
        probe({
          rows: [
            [1, 15, 1, "x"],
            [2, 5, 2, "x"],
          ],
          rowCount: 2,
        }),
      ],
    );
    expect(rowcount.map((delta) => delta.kind).sort()).toEqual([
      "DB_ROWCOUNT_CHANGED",
      "DB_ROW_ADDED",
    ]);
  });

  it("sem keyColumns, alinha por posição e DIZ que alinhou por posição", () => {
    const deltas = run(
      [probe({ keyColumns: [], rows: [[1, 15, 1, "x"]] })],
      [probe({ keyColumns: [], rows: [[1, 12, 1, "x"]] })],
    );
    expect(deltas[0]?.path).toBe("db:order.getDiscount?orderId=42/#0/discount_pct");
    expect(deltas[0]?.facts["alignedBy"]).toBe("position");
  });

  it("sonda que falhou de um lado é delta com os dois motivos; dos dois lados, é delta também — mas o dobro falhando é configuração", () => {
    const oneSide = run(
      [probe()],
      [probe({ error: "no such column: discount_pct", rows: [], rowCount: 0 })],
    );
    expect(oneSide[0]).toMatchObject({
      kind: "DB_PROBE_FAILED",
      before: null,
      after: "no such column: discount_pct",
      facts: { failedInBase: false, failedInHead: true },
    });
    const both = run(
      [probe({ error: "recusada", rows: [], rowCount: 0 })],
      [probe({ error: "recusada", rows: [], rowCount: 0 })],
    );
    expect(both[0]?.facts).toMatchObject({ failedInBase: true, failedInHead: true });
  });

  it("sonda presente de um lado só é DB_PROBE_MISSING", () => {
    const deltas = run([probe()], []);
    expect(deltas[0]).toMatchObject({ kind: "DB_PROBE_MISSING", facts: { side: "head" } });
  });

  it("valores mascarados comparam por hash e o delta diz que estava mascarado", () => {
    const deltas = run(
      [
        probe({
          columns: ["id", "email"],
          rows: [[1, "<masked:aaaa>"]],
          maskedColumns: ["email"],
          volatileColumns: [],
        }),
      ],
      [
        probe({
          columns: ["id", "email"],
          rows: [[1, "<masked:bbbb>"]],
          maskedColumns: ["email"],
          volatileColumns: [],
        }),
      ],
    );
    expect(deltas[0]?.facts["masked"]).toBe(true);
    expect(deltas[0]?.before).toBe("<masked:aaaa>");
  });
});
