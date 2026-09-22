import { PlatformError } from "@aletheia/shared";

import { type DeltaSignature, matchesSignature } from "../signature/index.js";
import type { DeltaKind, DeltaLayer } from "../types/delta.js";

import { type EvidenceRef, MIN_EVIDENCE, type SuppressionRule } from "./rule.js";

/**
 * Supressão APRENDIDA — regras por aplicação, declaradas em dado, não em código.
 *
 * O catálogo em `catalog.ts` é código do motor e vale para todo mundo; por
 * isso está vazio, e a razão está escrita nele. Ruído de uma aplicação não é
 * ruído de outra: "nesta loja, o menu reflete o catálogo e itens entram e saem"
 * é verdade do django-oscar e mentira de um site institucional. Uma regra
 * dessas só pode existir POR PROJETO, nascida da triagem humana daquele projeto
 * (RN-ORC-010) — e é isso que este módulo materializa.
 *
 * Três decisões que definem o mecanismo:
 *
 * 1. **A regra é declarativa e o casamento é estrutural.** Um `DeltaSignature`
 *    diz camada, tipo e ESQUELETO do caminho — o caminho de identidade com os
 *    nomes acessíveis apagados. O nome muda com o conteúdo (`li "Books Fiction
 *    Non-Fiction"` vira `li "Books"` quando os filhos somem); a estrutura é o
 *    que se repete de um PR para o outro. Nada aqui interpreta valor, e nada
 *    aqui é modelo: casar uma assinatura é comparar três strings (PA-01).
 *
 * 2. **A regra tem ciclo de vida, e só `ACTIVE` suprime.** Ela nasce `PROPOSED`
 *    pelo aprendizado, e a promoção é humana e assinada — mesmo espírito de
 *    RN-ORC-003/004 para hipóteses. Uma regra `PROPOSED` no arquivo do projeto
 *    é uma pergunta em aberto, não uma supressão adiada.
 *
 * 3. **Ativar exige a mesma evidência que qualquer regra do catálogo** —
 *    `MIN_EVIDENCE` casos rotulados NOISE em execuções DISTINTAS. Vinte deltas
 *    do mesmo PR são um caso: a mesma mudança vista em dez páginas. O motor se
 *    recusa a rodar com regra `ACTIVE` sem essa evidência (ver `pipeline.ts`),
 *    e não existe flag para forçar. Se existisse, seria usada.
 */

export const SUPPRESSION_SET_VERSION = "0.1.0";

export type SuppressionStatus = "PROPOSED" | "ACTIVE" | "REJECTED" | "RETIRED";

const STATUSES: readonly SuppressionStatus[] = ["PROPOSED", "ACTIVE", "REJECTED", "RETIRED"];

export type { DeltaSignature } from "../signature/index.js";
export { matchesSignature, pathSkeleton, signatureKey, signatureOf } from "../signature/index.js";

export interface LearnedSuppressionRule {
  /** `SUP-<projectId>-<nnn>`. */
  readonly id: string;
  readonly projectId: string;
  readonly status: SuppressionStatus;
  readonly description: string;
  /** O que a regra casa — a mesma assinatura que agrupa deltas no relatório. */
  readonly signature: DeltaSignature;
  readonly evidence: readonly EvidenceRef[];
  readonly proposedAtUtc: string;
  /**
   * Quem mudou o status para algo diferente de `PROPOSED`, e quando. Supressão
   * nunca é anônima: uma regra `ACTIVE` sem revisor identificado é inválida.
   */
  readonly reviewedBy: string | null;
  readonly reviewedAtUtc: string | null;
}

export interface SuppressionSet {
  readonly version: string;
  readonly projectId: string;
  readonly rules: readonly LearnedSuppressionRule[];
  /** Texto livre de quem mantém o arquivo. Nunca é lido pelo motor. */
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// Leitura e validação
// ---------------------------------------------------------------------------

export interface SuppressionSetIssue {
  readonly ruleId: string | null;
  readonly problem: string;
}

const RULE_ID = /^SUP-[A-Za-z0-9_.-]+-\d{3,}$/;

/**
 * Lê um conjunto a partir de JSON já parseado. Reprova forma errada com
 * `PlatformError` — arquivo de supressão inválido é falha nossa, não do código
 * do cliente (RN-CI-005). O que ele NÃO faz é validar evidência: isso é
 * `validateSuppressionSet`, separado, para o aprendizado poder ler um arquivo
 * cheio de `PROPOSED` sem tropeçar no que ainda não precisa valer.
 */
export function parseSuppressionSet(raw: unknown, source: string): SuppressionSet {
  const fail = (reason: string): never => {
    throw new PlatformError("SUPPRESSION_SET_INVALID", { source, reason });
  };
  if (!isRecord(raw)) return fail("raiz não é objeto");
  if (raw["version"] !== SUPPRESSION_SET_VERSION) {
    return fail(
      `versão ${String(raw["version"])} não suportada; esperado ${SUPPRESSION_SET_VERSION}`,
    );
  }
  const projectId = raw["projectId"];
  if (typeof projectId !== "string" || projectId.length === 0) return fail("projectId ausente");
  if (!Array.isArray(raw["rules"])) return fail("rules não é lista");

  const rules = (raw["rules"] as unknown[]).map((entry, index): LearnedSuppressionRule => {
    const where = `rules[${index}]`;
    if (!isRecord(entry)) return fail(`${where} não é objeto`);
    const id = entry["id"];
    if (typeof id !== "string" || !RULE_ID.test(id)) {
      return fail(`${where}: id inválido (esperado SUP-<projeto>-<nnn>): ${String(id)}`);
    }
    const status = entry["status"];
    if (typeof status !== "string" || !STATUSES.includes(status as SuppressionStatus)) {
      return fail(`${id}: status inválido: ${String(status)}`);
    }
    const description = entry["description"];
    if (typeof description !== "string") return fail(`${id}: description ausente`);
    const signature = entry["signature"];
    if (
      !isRecord(signature) ||
      typeof signature["layer"] !== "string" ||
      typeof signature["kind"] !== "string" ||
      typeof signature["pathSkeleton"] !== "string"
    ) {
      return fail(`${id}: signature precisa de layer, kind e pathSkeleton`);
    }
    if (!Array.isArray(entry["evidence"])) return fail(`${id}: evidence não é lista`);
    const evidence = (entry["evidence"] as unknown[]).map((item, at): EvidenceRef => {
      if (
        !isRecord(item) ||
        typeof item["runId"] !== "string" ||
        typeof item["deltaId"] !== "string" ||
        typeof item["labeledBy"] !== "string" ||
        typeof item["labeledAtUtc"] !== "string" ||
        typeof item["note"] !== "string"
      ) {
        return fail(
          `${id}: evidence[${at}] incompleta (runId, deltaId, labeledBy, labeledAtUtc, note)`,
        );
      }
      return {
        runId: item["runId"],
        deltaId: item["deltaId"],
        ...(typeof item["pairId"] === "string" ? { pairId: item["pairId"] } : {}),
        labeledBy: item["labeledBy"],
        labeledAtUtc: item["labeledAtUtc"],
        note: item["note"],
      };
    });
    const proposedAtUtc = entry["proposedAtUtc"];
    if (typeof proposedAtUtc !== "string") return fail(`${id}: proposedAtUtc ausente`);
    const reviewedBy = entry["reviewedBy"] ?? null;
    const reviewedAtUtc = entry["reviewedAtUtc"] ?? null;
    if (reviewedBy !== null && typeof reviewedBy !== "string")
      return fail(`${id}: reviewedBy inválido`);
    if (reviewedAtUtc !== null && typeof reviewedAtUtc !== "string") {
      return fail(`${id}: reviewedAtUtc inválido`);
    }
    if (typeof entry["projectId"] !== "string") return fail(`${id}: projectId ausente`);

    return {
      id,
      projectId: entry["projectId"],
      status: status as SuppressionStatus,
      description,
      signature: {
        layer: signature["layer"] as DeltaLayer,
        kind: signature["kind"] as DeltaKind,
        pathSkeleton: signature["pathSkeleton"],
      },
      evidence,
      proposedAtUtc,
      reviewedBy,
      reviewedAtUtc,
    };
  });

  const note = raw["note"];
  return {
    version: SUPPRESSION_SET_VERSION,
    projectId,
    rules,
    ...(typeof note === "string" ? { note } : {}),
  };
}

/**
 * Coerência do conjunto. Retorna problemas em vez de lançar, para o chamador
 * decidir: o motor recusa qualquer um; o aprendizado lista e segue.
 */
export function validateSuppressionSet(set: SuppressionSet): readonly SuppressionSetIssue[] {
  const issues: SuppressionSetIssue[] = [];
  const seen = new Set<string>();

  for (const rule of set.rules) {
    if (seen.has(rule.id)) issues.push({ ruleId: rule.id, problem: "id duplicado" });
    seen.add(rule.id);

    if (rule.projectId !== set.projectId) {
      issues.push({
        ruleId: rule.id,
        problem: `projectId da regra (${rule.projectId}) difere do conjunto (${set.projectId})`,
      });
    }
    if (rule.status !== "PROPOSED" && (rule.reviewedBy === null || rule.reviewedBy.trim() === "")) {
      issues.push({
        ruleId: rule.id,
        problem: `status ${rule.status} sem reviewedBy — mudança de status nunca é anônima`,
      });
    }
    if (rule.status === "ACTIVE") {
      const runs = new Set(rule.evidence.map((entry) => entry.runId));
      if (runs.size < MIN_EVIDENCE) {
        issues.push({
          ruleId: rule.id,
          problem:
            `ACTIVE com evidência de ${runs.size} execução(ões) distinta(s); ` +
            `ativar exige ${MIN_EVIDENCE} — ${rule.evidence.length} delta(s) do mesmo PR são um caso, não vários`,
        });
      }
      if (rule.description.trim().length < 20) {
        issues.push({ ruleId: rule.id, problem: "descrição insuficiente para auditoria" });
      }
    }
  }
  return issues;
}

/**
 * Converte as regras `ACTIVE` do conjunto na interface que o pipeline consome.
 * Só `ACTIVE`: `PROPOSED` é pergunta, `REJECTED` é resposta negativa e
 * `RETIRED` é história. A validação de evidência acontece de novo dentro do
 * motor (`validateSuppressionRules`), de propósito — o compilador não é a
 * última linha de defesa.
 */
export function compileLearnedRules(set: SuppressionSet): readonly SuppressionRule[] {
  return set.rules
    .filter((rule) => rule.status === "ACTIVE")
    .map((rule): SuppressionRule => ({
      id: rule.id,
      description: rule.description,
      projectId: rule.projectId,
      evidence: rule.evidence,
      matches: (delta) => matchesSignature(rule.signature, delta),
    }));
}

export function emptySuppressionSet(projectId: string): SuppressionSet {
  return { version: SUPPRESSION_SET_VERSION, projectId, rules: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
