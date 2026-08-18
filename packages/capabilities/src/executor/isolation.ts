import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { PlatformError, type DataStrategy, type Logger } from "@aletheia/shared";
import pg from "pg";

/**
 * Ambiente efêmero de DADOS — §14.6 nível 3 e §15.4, RN-DAT-013.
 *
 * "Descartabilidade, não limpeza" (PA-06): a execução não recebe o banco do
 * cliente, recebe um CLONE dele, e ao fim o clone é descartado. Não há
 * `DELETE` de rastro, não há `afterEach`; se a execução morrer no meio, o clone
 * fica órfão com o `runId` no nome e é apagado por quem faz faxina de
 * ambiente — nunca por rotina de cleanup do teste.
 *
 *   sqlite      cópia do arquivo para um caminho temporário; `dispose` apaga.
 *   postgresql  `CREATE DATABASE "aletheia_<runId>" TEMPLATE "<origem>"` no
 *               mesmo servidor (1–3 s, isolamento total); `dispose` dá `DROP`.
 *               O template não pode ter conexões ativas — é a regra do engine,
 *               e o erro diz isso.
 *
 * O que ISTO NÃO É: provisionamento da APLICAÇÃO. A build por PR (preview URL)
 * vem da plataforma do cliente (Vercel, etc. — ver o shim). Este módulo
 * resolve a metade que a §14.6 chama de sinergia: o mesmo mecanismo que isola
 * o banco do teste é o que dá o banco do ambiente por PR.
 */

export interface EphemeralDatabase {
  /** URL de conexão do clone — passa direto ao executor, nunca a log. */
  readonly url: string;
  readonly strategy: DataStrategy;
  /** Nome do artefato criado (arquivo ou database), para auditoria e faxina. */
  readonly name: string;
  dispose(): Promise<void>;
}

export interface ProvisionOptions {
  readonly strategy: DataStrategy;
  readonly runId: string;
  readonly logger: Logger;
}

export async function provisionEphemeralDatabase(
  templateUrl: string,
  options: ProvisionOptions,
): Promise<EphemeralDatabase> {
  if (options.strategy === "shared-degraded") {
    // Sem isolamento: a execução aponta para o banco como está, e o relatório
    // diz o modo (RN-EXE-007). Não há o que descartar.
    return {
      url: templateUrl,
      strategy: "shared-degraded",
      name: "(compartilhado)",
      dispose: async () => {},
    };
  }
  if (options.strategy !== "template-clone") {
    throw new PlatformError("DATABASE_UNREACHABLE", {
      strategy: options.strategy,
      reason: "estratégia ainda não suportada nesta fase (template-clone | shared-degraded)",
    });
  }
  if (templateUrl.startsWith("sqlite:") || templateUrl.startsWith("file:")) {
    return cloneSqlite(templateUrl, options);
  }
  if (templateUrl.startsWith("postgres://") || templateUrl.startsWith("postgresql://")) {
    return clonePostgres(templateUrl, options);
  }
  throw new PlatformError("DATABASE_UNREACHABLE", {
    engine: templateUrl.split(":")[0] ?? "",
    reason: "engine não suportado para template-clone (sqlite: | postgres://)",
  });
}

function cloneSqlite(templateUrl: string, options: ProvisionOptions): EphemeralDatabase {
  const source = templateUrl.slice(templateUrl.indexOf(":") + 1);
  const directory = join(tmpdir(), "aletheia-ephemeral");
  mkdirSync(directory, { recursive: true });
  const name = `${sanitize(options.runId)}-${basename(source)}`;
  const target = join(directory, name);
  try {
    copyFileSync(source, target);
  } catch (cause) {
    throw new PlatformError(
      "DATABASE_UNREACHABLE",
      { engine: "sqlite", reason: "template ilegível" },
      cause,
    );
  }
  options.logger.info("banco efêmero provisionado", {
    engine: "sqlite",
    strategy: "template-clone",
    name,
  });
  return {
    url: `sqlite:${target}`,
    strategy: "template-clone",
    name,
    dispose: async () => {
      rmSync(target, { force: true });
      options.logger.info("banco efêmero descartado", { engine: "sqlite", name });
      await Promise.resolve();
    },
  };
}

async function clonePostgres(
  templateUrl: string,
  options: ProvisionOptions,
): Promise<EphemeralDatabase> {
  const template = new URL(templateUrl);
  const templateDb = template.pathname.replace(/^\//, "");
  if (templateDb.length === 0) {
    throw new PlatformError("DATABASE_UNREACHABLE", {
      engine: "postgresql",
      reason: "URL do template sem nome de banco",
    });
  }
  // Conecta ao banco de manutenção do MESMO servidor para criar o clone.
  const admin = new URL(templateUrl);
  admin.pathname = "/postgres";
  const name = `aletheia_${sanitize(options.runId).toLowerCase()}`;
  const client = new pg.Client({ connectionString: admin.toString() });
  try {
    await client.connect();
  } catch (cause) {
    throw new PlatformError("DATABASE_UNREACHABLE", { engine: "postgresql" }, cause);
  }
  try {
    // Identificadores citados: nome do template vem da URL, nome do clone é
    // nosso. Nenhum valor de usuário entra sem aspas duplas escapadas.
    await client.query(`CREATE DATABASE ${quoteIdent(name)} TEMPLATE ${quoteIdent(templateDb)}`);
  } catch (cause) {
    throw new PlatformError(
      "DATABASE_UNREACHABLE",
      {
        engine: "postgresql",
        reason:
          "CREATE DATABASE … TEMPLATE falhou — o template não pode ter conexões ativas e o usuário precisa de CREATEDB",
      },
      cause,
    );
  } finally {
    await client.end();
  }
  const clone = new URL(templateUrl);
  clone.pathname = `/${name}`;
  options.logger.info("banco efêmero provisionado", {
    engine: "postgresql",
    strategy: "template-clone",
    name,
  });
  return {
    url: clone.toString(),
    strategy: "template-clone",
    name,
    dispose: async () => {
      const dropper = new pg.Client({ connectionString: admin.toString() });
      try {
        await dropper.connect();
        await dropper.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`);
        options.logger.info("banco efêmero descartado", { engine: "postgresql", name });
      } finally {
        await dropper.end();
      }
    },
  };
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 48);
}
