import type { RawDelta } from "../diff/types.js";
import type { Severity } from "../types/delta.js";

import {
  BEHAVIORAL_ATTRIBUTES,
  INTERACTIVE_ROLES,
  NAVIGATION_ATTRIBUTES,
  INTERACTIVE_TAGS,
  N_PLUS_ONE_AMPLIFICATION,
  NOTABLE_AMPLIFICATION,
  NOTABLE_VISUAL_AREA_RATIO,
  VISUAL_SEVERITY_CEILING,
  type Calibration,
} from "./calibration.js";

/**
 * Severidade de um delta — determinística, sem modelo, sem heurística oculta.
 * Cada ramo abaixo é uma afirmação sobre a aplicação do cliente que pode ser
 * verificada contra o corpus e corrigida.
 */
export function severityOf(delta: RawDelta): Severity {
  switch (delta.kind) {
    case "OBSERVATION_REMOVED":
      return "HIGH";
    case "OBSERVATION_ADDED":
      return "LOW";

    case "STATUS_CHANGED": {
      const headIsError = delta.facts["headIsError"] === true;
      const baseStatus = numberFact(delta.facts["baseStatus"]);
      // Terceiro que caiu é indisponibilidade de ambiente, não regressão do
      // código sob teste. Reportar sim; bloquear o PR do cliente por isso, não.
      if (delta.facts["thirdParty"] === true) return headIsError ? "MEDIUM" : "LOW";
      // Sucesso → erro é a regressão mais direta que existe.
      if (headIsError && baseStatus !== null && baseStatus < 400) return "CRITICAL";
      if (headIsError) return "HIGH";
      // Erro → sucesso é quase sempre correção, não regressão.
      return "LOW";
    }

    case "REQUEST_REMOVED": {
      // Calibração vinda de execução real: comparar duas capturas da MESMA
      // build de uma aplicação em produção produziu exatamente um delta — um
      // script de analytics de terceiro que carregou numa execução e não na
      // outra. Marcar isso como HIGH reprovaria um PR por causa de um CDN
      // alheio. O endpoint próprio que desaparece continua HIGH.
      if (delta.facts["dataResource"] !== true) {
        return delta.facts["thirdParty"] === true ? "LOW" : "MEDIUM";
      }
      return "HIGH";
    }
    case "REQUEST_ADDED":
      return "LOW";
    case "REQUEST_COUNT_CHANGED": {
      const amplification = numberFact(delta.facts["amplification"]);
      if (delta.facts["thirdParty"] === true) return "LOW";
      if (amplification !== null && amplification >= N_PLUS_ONE_AMPLIFICATION) return "HIGH";
      if (amplification !== null && amplification >= NOTABLE_AMPLIFICATION) return "MEDIUM";
      return "LOW";
    }

    // Campo que sumiu ou trocou de tipo quebra o consumidor do contrato.
    case "RESPONSE_FIELD_REMOVED":
    case "RESPONSE_TYPE_CHANGED":
      return "HIGH";
    case "RESPONSE_FIELD_CHANGED": {
      // HIPÓTESE a calibrar: número e booleano que mudam sem intenção declarada
      // são o caso central do problema do oráculo — "o desconto deveria ser 15%
      // e não 10%". A tela renderiza, a API devolve 200, e o valor está errado.
      // Texto muda por motivo legítimo (copy) com frequência muito maior, por
      // isso fica um degrau abaixo.
      const valueType = stringFact(delta.facts["valueType"]);
      return valueType === "number" || valueType === "boolean" ? "HIGH" : "MEDIUM";
    }
    case "RESPONSE_FIELD_ADDED":
      return "LOW";

    case "DOM_NODE_REMOVED": {
      if (isInteractive(delta)) return "HIGH";
      // Nó com texto que desaparece é conteúdo que o usuário deixou de
      // receber — a turma que sumiu da listagem, o cartão que não renderizou
      // mais. Invólucro sem texto é estrutura, e refatorar estrutura é rotina.
      //
      // EVIDÊNCIA (corpus `juventude`, 2026-08-11): no par de builds com
      // defeitos, remoções com texto revelaram 3 defeitos distintos que antes
      // não bloqueavam. No par de commits reais só com mudança intencional,
      // NENHUM nó foi removido — zero falso positivo. Base estreita: um PR de
      // uma aplicação. Enquanto não houver um segundo corpus, isto é hipótese
      // com evidência, não regra estabelecida.
      //
      // O SEGUNDO CORPUS CHEGOU (`oscar`, 2026-08-13) e cobrou uma correção:
      // conteúdo que apenas troca de invólucro não é conteúdo perdido. O commit
      // real `1f2772c4b` do django-oscar move o texto de dentro de um `<p>` para
      // o pai, e o motor bloqueava a mudança. Quando o texto do nó removido
      // continua no mesmo pai alinhado, isto é reembalagem: aparece na triagem,
      // não reprova ninguém. Ver `textPreservedIn` em `diff/dom.ts` — a
      // comparação é de texto completo justamente para não engolir o item que
      // some de uma listagem.
      if (delta.facts["textPreserved"] === true) return "MEDIUM";
      return delta.facts["carriesText"] === true ? "HIGH" : "MEDIUM";
    }
    case "DOM_NODE_ADDED":
      return "LOW";
    case "DOM_TEXT_CHANGED":
      return "MEDIUM";
    case "DOM_ROLE_CHANGED":
      return "HIGH";
    case "DOM_ACCESSIBLE_NAME_CHANGED":
      return "MEDIUM";

    case "DOM_ATTRIBUTE_ADDED": {
      const attribute = stringFact(delta.facts["attribute"]);
      // Controle que passou a nascer desabilitado: função perdida.
      if (attribute === "disabled" || attribute === "readonly") return "HIGH";
      return attribute !== null && BEHAVIORAL_ATTRIBUTES.has(attribute) ? "MEDIUM" : "LOW";
    }
    case "DOM_ATTRIBUTE_CHANGED":
    case "DOM_ATTRIBUTE_REMOVED": {
      const attribute = stringFact(delta.facts["attribute"]);
      if (attribute === null) return "LOW";
      // Destino de ação do usuário — para onde ele vai ao clicar, para onde o
      // formulário envia. Mudou sem intenção declarada: ou é link morto, ou é
      // dado errado no lugar certo (o WhatsApp do clube com um dígito trocado).
      //
      // EVIDÊNCIA (corpus `juventude`, 2026-08-11): o par com defeitos teve 2
      // defeitos distintos revelados só por `href`. O par de commits reais
      // mudou `src`, `srcset` e `loading` em cinco páginas — e nenhum `href`.
      // É por isso que a regra separa DESTINO de ENTREGA: subir `src` junto
      // teria bloqueado um PR legítimo que só recomprimiu uma imagem.
      if (NAVIGATION_ATTRIBUTES.has(attribute)) return "HIGH";
      return BEHAVIORAL_ATTRIBUTES.has(attribute) ? "MEDIUM" : "LOW";
    }

    case "DOM_CHILDREN_REORDERED":
      return "LOW";

    case "VISUAL_REGION_CHANGED": {
      // Teto em MEDIUM por decisão explícita — ver VISUAL_SEVERITY_CEILING.
      const areaRatio = numberFact(delta.facts["areaRatio"]);
      return areaRatio !== null && areaRatio >= NOTABLE_VISUAL_AREA_RATIO
        ? VISUAL_SEVERITY_CEILING
        : "LOW";
    }
    case "VISUAL_DIMENSIONS_CHANGED":
      // Altura de página muda com qualquer conteúdo a mais; sozinho não diz nada.
      return "LOW";
  }
}

export function scoreOf(severity: Severity, calibration: Calibration): number {
  return (
    calibration.severityWeight[severity] *
    calibration.proximityFactor *
    calibration.businessValueFactor
  );
}

function isInteractive(delta: RawDelta): boolean {
  const tag = stringFact(delta.facts["tag"]);
  if (tag !== null && INTERACTIVE_TAGS.has(tag)) return true;
  return INTERACTIVE_ROLES.has(extractRole(delta.path) ?? "");
}

/** Extrai `role=x` do caminho legível produzido por `describeNode`. */
function extractRole(path: string): string | null {
  const match = /\[role=([a-z]+)/.exec(path.slice(path.lastIndexOf(">")));
  return match?.[1] ?? null;
}

function numberFact(value: string | number | boolean | undefined): number | null {
  return typeof value === "number" ? value : null;
}

function stringFact(value: string | number | boolean | undefined): string | null {
  return typeof value === "string" ? value : null;
}
