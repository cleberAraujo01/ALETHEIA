import { DatabaseSync } from "node:sqlite";

import { PlatformError } from "@aletheia/shared";

import type { EngineAdapter, QueryRows } from "./adapter.js";

/**
 * SQLite via `node:sqlite` (builtin do Node ≥ 22.13): zero dependência nativa,
 * abre em modo SOMENTE LEITURA — o executor desta fase é READ, e a conexão diz
 * isso ao próprio engine (privilégio mínimo, §14.8), não só ao validador.
 *
 * É o engine dos testes e do primeiro demo. PostgreSQL entra com o primeiro
 * piloto que o tiver — e com o `EXPLAIN` do item 4 da §14.3.
 */
export function openSqlite(path: string): EngineAdapter {
  let database: DatabaseSync;
  try {
    database = new DatabaseSync(path, { readOnly: true });
  } catch (cause) {
    // A URL/caminho NÃO entra no contexto do erro de propósito: pode carregar
    // credencial em outros engines, e o padrão tem de ser o mesmo para todos.
    throw new PlatformError("DATABASE_UNREACHABLE", { engine: "sqlite" }, cause);
  }
  return {
    engine: "sqlite",
    // `async` de propósito: erro do engine vira rejeição, nunca exceção
    // síncrona no meio de um `await` de quem chamou.
    query(sql, parameters): Promise<QueryRows> {
      return new Promise((resolve, reject) => {
        try {
          resolve(runQuery(sql, parameters));
        } catch (cause) {
          reject(cause instanceof Error ? cause : new Error(String(cause)));
        }
      });
    },
    close(): Promise<void> {
      database.close();
      return Promise.resolve();
    },
  };

  function runQuery(sql: string, parameters: Parameters<EngineAdapter["query"]>[1]): QueryRows {
    {
      const statement = database.prepare(sql);
      // Parâmetro nomeado do driver — nunca interpolado (RN-DAT-002). Boolean
      // vira 0/1 porque o SQLite não tem o tipo; a capability declara `boolean`
      // e o executor já validou.
      const named: Record<string, string | number | null> = {};
      for (const [key, value] of Object.entries(parameters)) {
        named[`:${key}`] = typeof value === "boolean" ? (value ? 1 : 0) : value;
      }
      const rows = statement.all(named) as Record<
        string,
        string | number | boolean | null | bigint | Uint8Array
      >[];
      const columns = statement.columns().map((column) => column.name);
      return {
        columns,
        rows: rows.map((row) =>
          columns.map((column) => {
            const value = row[column];
            if (typeof value === "bigint") return Number(value);
            if (value instanceof Uint8Array) return `<blob:${value.byteLength}>`;
            return value ?? null;
          }),
        ),
      };
    }
  }
}
