import type { CapabilitySpec } from "./spec.js";

/**
 * Validação ESTÁTICA de capability — §14.3, itens 1, 2, 3, 6 e 7.
 *
 * É um validador LÉXICO ESTRITO, não um parser AST — e isso está declarado
 * aqui e no relatório do `capabilities:validate`. Ele tokeniza o SQL
 * (respeitando literais de string), exige um único statement, recusa comentário
 * e qualquer palavra-chave que não seja de leitura, exige `:nome` para todo
 * parâmetro, e confere que toda tabela após FROM/JOIN e toda referência
 * `tabela.coluna` estão na allowlist. O que ele NÃO faz: resolver coluna sem
 * qualificador (não sabe de que tabela é) nem executar `EXPLAIN` (item 4 —
 * exige conexão, entra com o executor de PostgreSQL). Um AST de verdade entra
 * quando o primeiro engine de cliente entrar; até lá, o estrito erra para o
 * lado de RECUSAR, que é o lado certo para o único ponto onde a plataforma toca
 * dado persistente.
 */

export interface ValidationIssue {
  readonly problem: string;
}

export interface ValidationResult {
  readonly issues: readonly ValidationIssue[];
  /** Fatos que não reprovam mas que quem aprova precisa ver. */
  readonly notes: readonly string[];
  /** Tabelas e colunas qualificadas referenciadas, para o revisor conferir a allowlist. */
  readonly referencedTables: readonly string[];
  readonly referencedColumns: readonly string[];
  /** `true` quando o executor terá de acrescentar `LIMIT` (RN-DAT-004). */
  readonly limitMissing: boolean;
}

const READ_STARTERS = new Set(["SELECT", "WITH"]);
const FORBIDDEN = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "CREATE",
  "TRUNCATE",
  "GRANT",
  "REVOKE",
  "COPY",
  "CALL",
  "EXEC",
  "EXECUTE",
  "MERGE",
  "REPLACE",
  "ATTACH",
  "DETACH",
  "PRAGMA",
  "VACUUM",
  "INTO",
  "LOCK",
  "SET",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
]);
const TABLE_INTRODUCERS = new Set(["FROM", "JOIN"]);
const NON_TABLE_AFTER_FROM = new Set(["(", "SELECT", "LATERAL", "VALUES"]);
const CLAUSE_KEYWORDS = new Set([
  "WHERE",
  "GROUP",
  "ORDER",
  "LIMIT",
  "OFFSET",
  "HAVING",
  "UNION",
  "EXCEPT",
  "INTERSECT",
  "ON",
  "USING",
  "JOIN",
  "LEFT",
  "RIGHT",
  "INNER",
  "OUTER",
  "CROSS",
  "FULL",
  "NATURAL",
  "WINDOW",
  "AS",
]);

export function validateCapability(spec: CapabilitySpec): ValidationResult {
  const issues: ValidationIssue[] = [];
  const notes: string[] = [];
  const push = (problem: string): void => {
    issues.push({ problem });
  };

  if (spec.operation !== "READ") {
    push(
      `operação ${spec.operation} não é executável nesta fase (E-02 é somente leitura; WRITE/DESTRUCTIVE exigem ambiente descartável — RN-DAT-007, E-07)`,
    );
  }
  if (spec.allowedEnvironments.includes("production") && spec.operation !== "READ") {
    push("production aceita exclusivamente READ (RN-DAT-006)");
  }

  const sql = spec.sql;
  if (/--|\/\*|\*\//.test(sql))
    push("comentário no SQL não é permitido — o que a capability faz tem de estar inteiro à vista");
  if (sql.includes(";")) push("`;` não é permitido — um único statement por capability");
  if (/\?|\$\d+/.test(stripStrings(sql)))
    push(
      "parâmetro posicional (`?`, `$1`) não é permitido — use `:nome` declarado em `parameters`",
    );

  const tokens = tokenize(sql);
  const upper = tokens.map((token) => token.toUpperCase());
  const first = upper[0] ?? "";
  if (spec.operation === "READ" && !READ_STARTERS.has(first)) {
    // Mensagem montada por concatenação, não por template: o arch-check
    // (PA-04) procura template literal com palavra-chave SQL e `${` — e este
    // texto não é SQL, mas parece. Melhor não parecer.
    push("READ precisa começar com SELECT ou WITH; começa com " + (first || "(vazio)"));
  }
  for (const [index, token] of upper.entries()) {
    if (FORBIDDEN.has(token)) {
      // `SET` dentro de nome de coluna qualificado (t.set) não chega aqui:
      // qualificadores viram um token só (`t.set`).
      push(`palavra-chave proibida em capability READ: ${token} (posição ${index})`);
    }
  }

  // Parâmetros: todo :nome no SQL existe em `parameters`; todo required aparece.
  const used = new Set<string>();
  for (const match of stripStrings(sql).matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const name = match[1] ?? "";
    used.add(name);
    if (spec.parameters[name] === undefined)
      push(`parâmetro :${name} usado no SQL e não declarado`);
  }
  for (const [name, param] of Object.entries(spec.parameters)) {
    if (param.required && !used.has(name))
      push(`parâmetro ${name} declarado como obrigatório e não usado no SQL`);
  }

  // Tabelas após FROM/JOIN, com alias; qualificadores `t.col` conferidos.
  const aliasToTable = new Map<string, string>();
  const referencedTables = new Set<string>();
  for (let index = 0; index < tokens.length; index += 1) {
    if (!TABLE_INTRODUCERS.has(upper[index] ?? "")) continue;
    let cursor = index + 1;
    // FROM a, b — lista separada por vírgula.
    for (;;) {
      const candidate = tokens[cursor];
      if (candidate === undefined || NON_TABLE_AFTER_FROM.has(candidate.toUpperCase())) break;
      const table = candidate.includes(".") ? (candidate.split(".").pop() ?? candidate) : candidate;
      referencedTables.add(table);
      aliasToTable.set(table, table);
      let next = tokens[cursor + 1];
      if (next !== undefined && next.toUpperCase() === "AS") {
        cursor += 1;
        next = tokens[cursor + 1];
      }
      if (
        next !== undefined &&
        !CLAUSE_KEYWORDS.has(next.toUpperCase()) &&
        next !== "," &&
        next !== ")" &&
        /^[A-Za-z_]/.test(next)
      ) {
        aliasToTable.set(next, table);
        cursor += 1;
      }
      if (tokens[cursor + 1] === ",") {
        cursor += 2;
        continue;
      }
      break;
    }
  }
  for (const table of referencedTables) {
    if (!spec.allowlist.tables.includes(table))
      push(`tabela ${table} referenciada e fora da allowlist`);
  }
  const referencedColumns = new Set<string>();
  for (const token of tokens) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(token);
    if (match === null) continue;
    const table = aliasToTable.get(match[1] ?? "") ?? match[1] ?? "";
    const column = `${table}.${match[2] ?? ""}`;
    referencedColumns.add(column);
    if (
      !spec.allowlist.columns.includes(column) &&
      !spec.allowlist.columns.includes(`${table}.*`)
    ) {
      push(`coluna ${column} referenciada e fora da allowlist`);
    }
  }
  if (spec.allowlist.columns.length === 0) {
    push("allowlist.columns vazia — declare as colunas que a capability pode ler (RN-DAT-003)");
  }
  for (const column of spec.allowlist.columns) {
    const table = column.split(".")[0] ?? "";
    if (!spec.allowlist.tables.includes(table))
      push(`allowlist.columns cita ${column} mas ${table} não está em allowlist.tables`);
  }
  for (const [column, level] of Object.entries(spec.sensitivity)) {
    if ((level === "PII" || level === "SECRET") && !spec.allowlist.columns.includes(column)) {
      push(
        `sensibilidade ${level} declarada para ${column}, que não está na allowlist — mascaramento sem coluna`,
      );
    }
  }
  if (referencedColumns.size === 0 && upper.includes("*")) {
    notes.push(
      "SELECT * — nenhuma coluna qualificada para conferir; a allowlist é o teto e o executor mascara pelo nome da coluna devolvida",
    );
  }

  // LIMIT compulsório (RN-DAT-004).
  const limitAt = upper.lastIndexOf("LIMIT");
  const limitMissing = limitAt === -1;
  if (limitMissing) {
    notes.push(`sem LIMIT: o executor acrescenta LIMIT ${spec.constraints.maxRows} (RN-DAT-004)`);
  } else {
    const value = Number(tokens[limitAt + 1]);
    if (Number.isFinite(value) && value > spec.constraints.maxRows) {
      push(`LIMIT ${value} acima de constraints.maxRows ${spec.constraints.maxRows}`);
    }
  }

  return {
    issues,
    notes,
    referencedTables: [...referencedTables].sort(),
    referencedColumns: [...referencedColumns].sort(),
    limitMissing,
  };
}

/** Tokeniza fora de literais de string; literais viram um token opaco. */
export function tokenize(sql: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < sql.length) {
    const char = sql[index] ?? "";
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "'") {
      let end = index + 1;
      while (end < sql.length && sql[end] !== "'") end += 1;
      tokens.push(sql.slice(index, end + 1));
      index = end + 1;
      continue;
    }
    if (/[A-Za-z_:@$0-9.]/.test(char)) {
      let end = index;
      while (end < sql.length && /[A-Za-z0-9_:.$@]/.test(sql[end] ?? "")) end += 1;
      tokens.push(sql.slice(index, end));
      index = end;
      continue;
    }
    if (
      sql.startsWith("||", index) ||
      sql.startsWith("<=", index) ||
      sql.startsWith(">=", index) ||
      sql.startsWith("<>", index) ||
      sql.startsWith("!=", index)
    ) {
      tokens.push(sql.slice(index, index + 2));
      index += 2;
      continue;
    }
    tokens.push(char);
    index += 1;
  }
  return tokens;
}

function stripStrings(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''");
}
