import type { RawDelta } from "../diff/types.js";
import type { Severity } from "../types/delta.js";

import {
  BEHAVIORAL_ATTRIBUTES,
  CONSTRAINT_ATTRIBUTES,
  INTERACTIVE_ROLES,
  NAVIGATION_ATTRIBUTES,
  SENTINEL_VALUES,
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
      // Prefetch do roteador (`_rsc`): presença depende do instante do idle.
      // MEDIDO no piloto (juventude, rodada 2): os prefetches da home caíram
      // na observação seguinte num lado e não no outro, e um app IDÊNTICO
      // levou 4 REQUEST_REMOVED HIGH — falso positivo bloqueante. É o análogo
      // de origem própria do caso do analytics abaixo: o sinal diz "o timing
      // variou". Se a navegação de fato quebrar, DOM e console acusam (foi
      // assim no vite-docs #23201).
      if (delta.facts["speculative"] === true) return "LOW";
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
      // Contagem de prefetch varia com o timing do idle — mesmo racional do
      // REQUEST_REMOVED especulativo acima.
      if (delta.facts["speculative"] === true) return "LOW";
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
      // Elemento interativo SEM TEXTO — botão de ícone, controle rotulado só
      // por `aria-label`. É o único caso que esta condição cobre sozinha, e o
      // estreitamento veio de medição, não de gosto.
      //
      // ABLAÇÃO (2026-08-14, quatro pares reais): retirar `isInteractive`
      // inteira não mudava NADA — 5/9 no juventude e 4/7 no oscar, mesmos
      // deltas. Ela era redundante com `carriesText` em 100% dos casos dos dois
      // corpora, porque link e botão quase sempre carregam texto. Retirar
      // `carriesText` custava 3 defeitos no juventude e 1 no oscar.
      //
      // Estreitar em vez de remover preserva a classe que nenhum corpus testa
      // — o botão de comprar que é só um ícone — a custo medido zero.
      if (delta.facts["carriesText"] !== true && isInteractive(delta)) return "HIGH";
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
    case "DOM_ACCESSIBLE_NAME_CHANGED": {
      // NOME PERDIDO ≠ NOME TROCADO. Trocar o rótulo de um botão é copy; ficar
      // sem rótulo nenhum é o elemento deixando de existir para quem não
      // enxerga a tela. A condição que separa os dois não é o nome do atributo
      // que sumiu, é o que sobrou: um link que perde `aria-label` mas mantém o
      // texto continua anunciável; uma imagem que perde `alt` não tem para onde
      // cair.
      //
      // EVIDÊNCIA (corpus `oscar`, defeito `O7`, medido em 2026-08-15): a
      // miniatura do produto perde `alt` em todas as listagens — 105 deltas,
      // todos rotulados como regressão, nenhum falso positivo. O defeito não
      // muda um pixel e passava inteiro. Nos seis pares sem defeito — dois PRs
      // reais e quatro pisos de ruído — nenhum nó perdeu o nome acessível.
      //
      // A severidade fica no delta de CONSEQUÊNCIA, não no `DOM_ATTRIBUTE_REMOVED@alt`
      // que o causou: o atributo continua LOW, e assim o mesmo defeito não é
      // contado duas vezes no relatório.
      if (delta.after === null && delta.facts["textFallback"] !== true) return "HIGH";
      return "MEDIUM";
    }

    case "DOM_ATTRIBUTE_ADDED": {
      const attribute = stringFact(delta.facts["attribute"]);
      // Controle que passou a nascer desabilitado: função perdida.
      if (attribute === "disabled" || attribute === "readonly") return "HIGH";
      if (isSentinel(delta.after)) return "HIGH";
      return attribute !== null && BEHAVIORAL_ATTRIBUTES.has(attribute) ? "MEDIUM" : "LOW";
    }
    case "DOM_ATTRIBUTE_CHANGED":
    case "DOM_ATTRIBUTE_REMOVED": {
      const attribute = stringFact(delta.facts["attribute"]);
      if (attribute === null) return "LOW";

      // SENTINELA — o valor virou a representação textual de "nada". Não é
      // dado diferente, é ausência de dado vazando para dentro da página, e a
      // consequência independe de qual atributo recebeu: o usuário submete ou
      // segue um artefato de serialização.
      //
      // EVIDÊNCIA (corpus `oscar`, defeito `O3`): `value=""` vira
      // `value="None"` no campo escondido de busca; paginar o catálogo passa a
      // buscar pela palavra "None". Zero ocorrências nos seis pares sem defeito.
      // Ver `SENTINEL_VALUES` para o caso que pode falsificar a regra.
      if (isSentinel(delta.after) && !isSentinel(delta.before)) return "HIGH";

      // RESTRIÇÃO RELAXADA — o formulário passou a aceitar o que recusava.
      // Só na REMOÇÃO: o atributo que some tira a barreira inteira, enquanto
      // um `maxlength` que muda de valor pode estar apertando ou afrouxando, e
      // decidir qual exigiria comparar números que nenhum par exercita.
      //
      // EVIDÊNCIA (corpus `juventude`, defeito `F7`): o campo de e-mail perde
      // `required` e o clube passa a receber mensagem sem remetente para
      // responder. Zero ocorrências nos seis pares sem defeito.
      if (delta.kind === "DOM_ATTRIBUTE_REMOVED" && CONSTRAINT_ATTRIBUTES.has(attribute)) {
        return "HIGH";
      }

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

    case "CONSOLE_MESSAGE_ADDED": {
      // Erro novo no console é a aplicação DIZENDO que algo falhou. Não é
      // diferença de forma que alguém precise interpretar — é diagnóstico
      // emitido pelo próprio código sob teste, e por isso não sofre da
      // ambiguidade que derrubou as regras de remoção de nó (§10.9).
      //
      // MEDIDO antes de existir (§10.10): nos sete pares, mensagem nova apareceu
      // SÓ no par com defeitos — 7 erros, um por página, do 404 da rota
      // quebrada. Zero em três PRs legítimos e nos dois pisos de ruído.
      //
      // `warn` fica um degrau abaixo porque aviso de framework em modo de
      // desenvolvimento é rotina; `log` é a aplicação falando consigo mesma.
      const level = stringFact(delta.facts["level"]);
      if (level === "error") return "HIGH";
      return level === "warn" ? "MEDIUM" : "LOW";
    }
    case "CONSOLE_MESSAGE_REMOVED":
      // Erro que PAROU de acontecer é quase sempre correção. Reporta para o
      // relatório ficar completo; não reprova ninguém por ter consertado algo.
      return "LOW";
    case "CONSOLE_COUNT_CHANGED": {
      // A mesma mensagem passando de 1 para 40 é sinal de laço ou de retry em
      // cascata — mas a contagem sozinha varia com timing, então fica abaixo de
      // "mensagem nova". HIPÓTESE: nenhum dos sete pares exerceu este caso.
      const level = stringFact(delta.facts["level"]);
      return level === "error" ? "MEDIUM" : "LOW";
    }

    // Banco (O6). O que uma capability aprovada devolve é ESTADO PERSISTIDO
    // depois do mesmo caminho na base e no head; divergência aqui é o caso
    // central do problema do oráculo (a tela renderiza, a API responde 200, o
    // desconto no banco está errado). HIPÓTESE declarada, sem par real ainda:
    // valor de campo que muda é HIGH; linha que some ou aparece é HIGH; sonda
    // que falhou de um lado é HIGH (a mudança quebrou a consulta aprovada);
    // contagem sozinha é MEDIUM porque a linha correspondente já é delta.
    // Alinhamento por POSIÇÃO (capability sem keyColumns) rebaixa um degrau: a
    // identidade da linha é presumida, não declarada.
    case "DB_FIELD_CHANGED":
    case "DB_ROW_ADDED":
    case "DB_ROW_REMOVED":
      return delta.facts["alignedBy"] === "position" ? "MEDIUM" : "HIGH";
    case "DB_PROBE_FAILED":
      // Falhou dos DOIS lados: capability recusada, banco fora, parâmetro
      // errado — configuração, não regressão. Visível, não bloqueia. Falhou de
      // UM lado só: a mudança quebrou a consulta aprovada.
      return delta.facts["failedInBase"] === true && delta.facts["failedInHead"] === true
        ? "LOW"
        : "HIGH";
    case "DB_PROBE_MISSING":
      // A sonda existiu de um lado só: jornada mudou ou captura antiga. Lacuna
      // declarada na cobertura; como delta, só chama atenção.
      return "MEDIUM";
    case "DB_ROWCOUNT_CHANGED":
      return "MEDIUM";
  }
}

export function scoreOf(severity: Severity, calibration: Calibration): number {
  return (
    calibration.severityWeight[severity] *
    calibration.proximityFactor *
    calibration.businessValueFactor
  );
}

/**
 * O valor é a representação textual de "nada" que alguma linguagem produziu ao
 * serializar um valor ausente? Ver `SENTINEL_VALUES`.
 *
 * `null` aqui é o atributo NÃO EXISTIR, que é coisa diferente de existir com
 * valor sentinela — e é por isso que a checagem não trata os dois igual.
 */
function isSentinel(value: string | null): boolean {
  return value !== null && SENTINEL_VALUES.has(value.trim().toLowerCase());
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
