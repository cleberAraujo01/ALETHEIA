import { PlatformError } from "@aletheia/shared";
import pg from "pg";

import type { EngineAdapter, QueryRows } from "./adapter.js";

/**
 * PostgreSQL — o "padrão-ouro" da §14.4. Mesmo contrato do sqlite, com o que
 * o engine oferece a mais e que a §14.8 pede:
 *
 *   - `:nome` vira `$n` na borda do adaptador (o driver do pg é posicional);
 *     o validador já garantiu que não há `$` no SQL da capability, então a
 *     conversão é injetiva e determinística — e continua sendo PARÂMETRO, não
 *     interpolação (RN-DAT-002);
 *   - cada consulta roda numa transação `READ ONLY` com `statement_timeout`
 *     da própria capability. Escrever falha no engine mesmo que o validador
 *     falhasse — a mesma segunda barreira do sqlite somente leitura;
 *   - a URL de conexão morre aqui. Nenhum erro a carrega.
 */
export function openPostgres(url: string): EngineAdapter {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  return {
    engine: "postgresql",
    async query(sql, parameters, timeoutMs): Promise<QueryRows> {
      const { text, values } = positional(sql, parameters);
      let client: pg.PoolClient;
      try {
        client = await pool.connect();
      } catch (cause) {
        throw new PlatformError("DATABASE_UNREACHABLE", { engine: "postgresql" }, cause);
      }
      try {
        await client.query("BEGIN READ ONLY");
        // O timeout é declarado na capability; entra como parâmetro de sessão,
        // nunca concatenado no SQL da consulta.
        await client.query("SELECT set_config('statement_timeout', $1, true)", [String(timeoutMs)]);
        const result = await client.query({ text, values, rowMode: "array" });
        await client.query("COMMIT");
        const columns = result.fields.map((field) => field.name);
        const rows = (result.rows as unknown[][]).map((row) =>
          row.map((value) => {
            if (value === null || value === undefined) return null;
            if (
              typeof value === "number" ||
              typeof value === "boolean" ||
              typeof value === "string"
            )
              return value;
            if (typeof value === "bigint") return Number(value);
            if (value instanceof Date) return value.toISOString();
            if (Buffer.isBuffer(value)) return `<blob:${value.byteLength}>`;
            return JSON.stringify(value);
          }),
        );
        return { columns, rows };
      } catch (cause) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Já revertida ou conexão morta — o erro que importa é o original.
        }
        throw cause;
      } finally {
        client.release();
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

/** `:nome` → `$n`, na ordem de primeira ocorrência; valores na mesma ordem. */
export function positional(
  sql: string,
  parameters: Readonly<Record<string, string | number | boolean>>,
): { text: string; values: (string | number | boolean)[] } {
  const order: string[] = [];
  const text = sql.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (whole, name: string) => {
    if (parameters[name] === undefined) return whole;
    let index = order.indexOf(name);
    if (index === -1) {
      order.push(name);
      index = order.length - 1;
    }
    return `$${index + 1}`;
  });
  return { text, values: order.map((name) => parameters[name] as string | number | boolean) };
}
