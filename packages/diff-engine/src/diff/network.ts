import type { NormalizedExchange } from "../normalize/network.js";
import { isSpeculativeNavigationRequest } from "../normalize/volatile.js";
import type { JsonValue } from "../types/capture.js";

import { type DeltaBudget, truncateValue, type RawDelta } from "./types.js";

/**
 * Recursos que carregam dado da aplicação. O resto (script, imagem, fonte,
 * folha de estilo) é subrecurso: seu desaparecimento é verificado de forma
 * mais confiável pelas camadas de DOM e visual, que veem o efeito e não a
 * causa.
 */
const DATA_RESOURCE_TYPES = new Set(["xhr", "fetch", "document"]);

/**
 * Diferenciação de rede — estágio 3, camada de rede.
 *
 * O alinhamento é por `method + url normalizada`, e a **cardinalidade** é
 * comparada antes do conteúdo. Isso é o que torna detectável o N+1 que surgiu
 * (§2.4.1): uma chamada que virou 40 não muda payload nenhum, muda a contagem.
 */
export function diffNetwork(
  observationId: string,
  base: readonly NormalizedExchange[],
  head: readonly NormalizedExchange[],
  budget: DeltaBudget,
): RawDelta[] {
  const out: RawDelta[] = [];
  const emit = (delta: RawDelta): void => {
    if (budget.take()) out.push(delta);
  };

  const baseGroups = groupByIdentity(base);
  const headGroups = groupByIdentity(head);
  const keys = [...new Set([...baseGroups.keys(), ...headGroups.keys()])].sort();

  for (const key of keys) {
    const baseList = baseGroups.get(key) ?? [];
    const headList = headGroups.get(key) ?? [];
    const sample = baseList[0] ?? headList[0];
    if (sample === undefined) continue;
    const label = `${sample.method} ${sample.url}`;
    // A normalização remove a origem própria da aplicação; o que sobrar com
    // esquema é de terceiro. Distinguir importa: um endpoint nosso que sumiu é
    // sinal forte, um script de analytics que não carregou não diz nada sobre
    // o código do cliente — e bloquear PR por indisponibilidade de terceiro é
    // o caminho mais rápido para o time desligar o gate.
    const thirdParty = /^[a-z]+:\/\//i.test(sample.url);
    const dataResource = DATA_RESOURCE_TYPES.has(sample.resourceType);
    // Prefetch do roteador: presença depende do instante do idle, não do
    // código — a cardinalidade dele carrega o fato e a severidade decide.
    const speculative = isSpeculativeNavigationRequest(sample.url);

    if (baseList.length === 0) {
      emit({
        layer: "NETWORK",
        kind: "REQUEST_ADDED",
        observationId,
        path: label,
        before: null,
        after: `${headList.length}× ${label}`,
        facts: {
          method: sample.method,
          resourceType: sample.resourceType,
          headCount: headList.length,
          thirdParty,
          dataResource,
          speculative,
        },
      });
      continue;
    }

    if (headList.length === 0) {
      emit({
        layer: "NETWORK",
        kind: "REQUEST_REMOVED",
        observationId,
        path: label,
        before: `${baseList.length}× ${label}`,
        after: null,
        facts: {
          method: sample.method,
          resourceType: sample.resourceType,
          baseCount: baseList.length,
          thirdParty,
          dataResource,
          speculative,
        },
      });
      continue;
    }

    if (baseList.length !== headList.length) {
      emit({
        layer: "NETWORK",
        kind: "REQUEST_COUNT_CHANGED",
        observationId,
        path: label,
        before: String(baseList.length),
        after: String(headList.length),
        facts: {
          method: sample.method,
          baseCount: baseList.length,
          headCount: headList.length,
          amplification: Number((headList.length / baseList.length).toFixed(2)),
          thirdParty,
          dataResource,
          speculative,
        },
      });
    }

    const pairs = Math.min(baseList.length, headList.length);
    for (let index = 0; index < pairs; index += 1) {
      const baseExchange = baseList[index];
      const headExchange = headList[index];
      if (baseExchange === undefined || headExchange === undefined) continue;
      diffExchange(
        observationId,
        `${label}#${index}`,
        baseExchange,
        headExchange,
        thirdParty,
        speculative,
        emit,
      );
    }
  }

  return out;
}

function diffExchange(
  observationId: string,
  path: string,
  base: NormalizedExchange,
  head: NormalizedExchange,
  thirdParty: boolean,
  speculative: boolean,
  emit: (delta: RawDelta) => void,
): void {
  if (base.status !== head.status) {
    emit({
      layer: "NETWORK",
      kind: "STATUS_CHANGED",
      observationId,
      path,
      before: String(base.status),
      after: String(head.status),
      facts: {
        method: base.method,
        baseStatus: base.status,
        headStatus: head.status,
        headIsError: head.status >= 400,
        thirdParty,
      },
    });
  }

  diffJson(
    observationId,
    `${path} request`,
    base.requestBody,
    head.requestBody,
    "",
    emit,
    thirdParty,
  );
  // Corpo NÃO OBSERVADO de um lado (`<undrained>`: a página abandonou o download;
  // `<oversized>`: grande demais para a evidência) não é mudança de tipo — é
  // lacuna, e o marcador já está na captura. Medido no piso do Sauce Demo:
  // a mesma build reprovava a si mesma porque uma telemetria de terceiro foi
  // abandonada numa captura e drenada na outra.
  //
  // A variante ESPECULATIVA da mesma lição, medida na rodada 2 do piloto: o
  // prefetch atrasado que a navegação abortou fica com corpo `null` na
  // captura, e `null` de um lado contra o payload do outro virava
  // RESPONSE_TYPE_CHANGED HIGH — bloqueio por timing. Só vale para requisição
  // especulativa: em endpoint de dado de verdade, `null` de um lado continua
  // sendo comparado, porque lá pode ser o corpo que deixou de existir.
  const bodyUnobserved =
    isUnobserved(base.responseBody) ||
    isUnobserved(head.responseBody) ||
    (speculative && (base.responseBody === null) !== (head.responseBody === null));
  if (!bodyUnobserved) {
    diffJson(
      observationId,
      `${path} response`,
      base.responseBody,
      head.responseBody,
      "",
      emit,
      thirdParty,
    );
  }
}

function isUnobserved(body: JsonValue | null): boolean {
  return typeof body === "string" && (body === "<undrained>" || body.startsWith("<oversized:"));
}

/**
 * Diff estrutural de JSON com JSON Pointer (RFC 6901) como caminho.
 * Arrays são comparados por posição — ver nota em `normalize/network.ts` sobre
 * por que "array não ordenado" é decisão de supressão com evidência, não
 * suposição do motor.
 */
function diffJson(
  observationId: string,
  path: string,
  base: JsonValue | null,
  head: JsonValue | null,
  pointer: string,
  emit: (delta: RawDelta) => void,
  thirdParty: boolean,
): void {
  if (base === null && head === null) return;

  const baseType = typeOf(base);
  const headType = typeOf(head);

  if (baseType !== headType) {
    emit({
      layer: "NETWORK",
      kind: "RESPONSE_TYPE_CHANGED",
      observationId,
      path: `${path}${pointer}`,
      before: truncateValue(render(base)),
      after: truncateValue(render(head)),
      facts: { baseType, headType, thirdParty },
    });
    return;
  }

  if (baseType === "object") {
    const baseObject = base as Record<string, JsonValue>;
    const headObject = head as Record<string, JsonValue>;
    const keys = [...new Set([...Object.keys(baseObject), ...Object.keys(headObject)])].sort();
    for (const key of keys) {
      const child = `${pointer}/${escapePointer(key)}`;
      const baseValue = baseObject[key];
      const headValue = headObject[key];

      if (baseValue === undefined) {
        emit({
          layer: "NETWORK",
          kind: "RESPONSE_FIELD_ADDED",
          observationId,
          path: `${path}${child}`,
          before: null,
          after: truncateValue(render(headValue ?? null)),
          facts: { field: key },
        });
        continue;
      }
      if (headValue === undefined) {
        emit({
          layer: "NETWORK",
          kind: "RESPONSE_FIELD_REMOVED",
          observationId,
          path: `${path}${child}`,
          before: truncateValue(render(baseValue)),
          after: null,
          facts: { field: key },
        });
        continue;
      }
      diffJson(observationId, path, baseValue, headValue, child, emit, thirdParty);
    }
    return;
  }

  if (baseType === "array") {
    const baseArray = base as JsonValue[];
    const headArray = head as JsonValue[];
    const length = Math.max(baseArray.length, headArray.length);
    for (let index = 0; index < length; index += 1) {
      const child = `${pointer}/${index}`;
      const baseValue = baseArray[index];
      const headValue = headArray[index];

      if (baseValue === undefined) {
        emit({
          layer: "NETWORK",
          kind: "RESPONSE_FIELD_ADDED",
          observationId,
          path: `${path}${child}`,
          before: null,
          after: truncateValue(render(headValue ?? null)),
          facts: { index, baseLength: baseArray.length, headLength: headArray.length },
        });
        continue;
      }
      if (headValue === undefined) {
        emit({
          layer: "NETWORK",
          kind: "RESPONSE_FIELD_REMOVED",
          observationId,
          path: `${path}${child}`,
          before: truncateValue(render(baseValue)),
          after: null,
          facts: { index, baseLength: baseArray.length, headLength: headArray.length },
        });
        continue;
      }
      diffJson(observationId, path, baseValue, headValue, child, emit, thirdParty);
    }
    return;
  }

  if (base !== head) {
    emit({
      layer: "NETWORK",
      kind: "RESPONSE_FIELD_CHANGED",
      observationId,
      path: `${path}${pointer}`,
      before: truncateValue(render(base)),
      after: truncateValue(render(head)),
      facts: { valueType: baseType },
    });
  }
}

function groupByIdentity(
  exchanges: readonly NormalizedExchange[],
): Map<string, NormalizedExchange[]> {
  const groups = new Map<string, NormalizedExchange[]>();
  for (const exchange of exchanges) {
    const bucket = groups.get(exchange.identityKey);
    if (bucket === undefined) groups.set(exchange.identityKey, [exchange]);
    else bucket.push(exchange);
  }
  return groups;
}

function typeOf(value: JsonValue | null): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function render(value: JsonValue | null): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** RFC 6901: `~` vira `~0` e `/` vira `~1`. */
function escapePointer(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}
