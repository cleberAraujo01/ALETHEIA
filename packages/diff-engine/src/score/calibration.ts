import type { Severity } from "../types/delta.js";

/**
 * Calibração — estágio 5 do pipeline.
 *
 * §12.4 define a pontuação como `severidade × proximidade ao diff × valor de
 * negócio`. Dos três fatores, **só o primeiro existe na Fase 0**:
 *
 *   - proximidade ao diff de código exige mapear delta → arquivo alterado, o
 *     que depende do World Model (Fase 2);
 *   - valor de negócio exige jornada anotada com receita/criticidade (Fase 2).
 *
 * Os dois fatores ausentes valem 1.0 e estão declarados no relatório como
 * lacuna, em vez de embutidos num número que aparentaria precisão que não
 * temos.
 *
 * ESTADO DOS NÚMEROS (atualizado em 2026-08-11, após a medição de saída da
 * Fase 0 — `docs/medicao-fase-0.md`):
 *
 *   - o LIMIAR (70) e os PESOS por severidade continuam hipótese. Não foram
 *     alterados pela medição; o que mudou foi a severidade atribuída a dois
 *     tipos de delta, em `score/index.ts`, cada uma com evidência anotada no
 *     ponto de decisão;
 *   - as regras de severidade que a medição produziu valem contra UMA
 *     aplicação e UM PR intencional. São hipóteses com evidência, não regras
 *     estabelecidas. O experimento que pode derrubá-las é um segundo corpus,
 *     de outra aplicação;
 *   - `proximityFactor` e `businessValueFactor` seguem em 1.0 porque os
 *     insumos deles não existem antes da Fase 2.
 *
 * O procedimento continua o mesmo: toda mudança aqui reporta delta de precisão
 * e recall nos dois corpora — o de defeitos e o de mudança intencional. Subir
 * detecção é trivial se reprovar todo mundo for aceitável.
 */
export interface Calibration {
  readonly severityWeight: Readonly<Record<Severity, number>>;
  /** Score mínimo para um delta ser classificado como REGRESSION. */
  readonly regressionThreshold: number;
  /**
   * Fatores ainda inexistentes. Mantidos explícitos para que a fórmula do
   * §12.4 fique visível no código e a lacuna, óbvia.
   */
  readonly proximityFactor: number;
  readonly businessValueFactor: number;
}

export const DEFAULT_CALIBRATION: Calibration = {
  severityWeight: {
    CRITICAL: 100,
    HIGH: 70,
    MEDIUM: 40,
    LOW: 10,
  },
  regressionThreshold: 70,
  proximityFactor: 1,
  businessValueFactor: 1,
};

/**
 * Elementos com os quais o usuário interage. Perder um destes é perder função,
 * não estética — daí a diferença de severidade em relação a um contêiner.
 */
export const INTERACTIVE_TAGS = new Set([
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "form",
  "summary",
  "dialog",
]);

export const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "slider",
  "spinbutton",
  "switch",
  "tab",
]);

/**
 * Atributos que dizem PARA ONDE uma ação do usuário leva. Distintos dos demais
 * comportamentais porque errar aqui não degrada a experiência: leva a pessoa ao
 * lugar errado, ou a lugar nenhum.
 *
 * `src` ficou deliberadamente FORA. Ele diz como um recurso é entregue, não
 * para onde o usuário vai — e recurso muda de URL por motivo legítimo o tempo
 * todo (qualidade, CDN, hash de build). Medido no corpus `juventude`: um PR
 * real que só recomprimiu a imagem do banner mudou `src` em cinco páginas.
 */
export const NAVIGATION_ATTRIBUTES = new Set(["href", "action", "formaction"]);

/**
 * Atributos que alteram comportamento, não aparência. `disabled` aparecendo
 * num botão que antes funcionava é regressão funcional clássica.
 */
export const BEHAVIORAL_ATTRIBUTES = new Set([
  "href",
  "src",
  "action",
  "method",
  "type",
  "name",
  "value",
  "disabled",
  "readonly",
  "required",
  "checked",
  "selected",
  "target",
  "for",
]);

/**
 * HIPÓTESE: amplificação de chamadas a partir de 5× indica N+1 emergente;
 * abaixo de 2× costuma ser variação de carregamento. Validar contra corpus.
 */
export const N_PLUS_ONE_AMPLIFICATION = 5;
export const NOTABLE_AMPLIFICATION = 2;

/**
 * Área mínima, como fração da tela comparada, para uma região visual alterada
 * deixar de ser tratada como cosmética. HIPÓTESE: 1% da tela.
 */
export const NOTABLE_VISUAL_AREA_RATIO = 0.01;

/**
 * A camada visual é, por construção, a de maior taxa de falso positivo:
 * qualquer mudança intencional de layout altera milhares de pixels e é
 * indistinguível de uma quebra sem uma fonte de intenção.
 *
 * Enquanto não houver corpus medido, nenhum delta visual atinge severidade
 * suficiente para bloquear um PR — o teto é MEDIUM, o que os mantém como
 * UNDETERMINED e visíveis no relatório. É a posição honesta: reportar sem
 * bloquear é diferente de esconder, e bloquear um PR por redesenho de botão
 * destruiria a confiança no gate mais rápido do que qualquer falso negativo.
 *
 * Revisão prevista: subir o teto quando (a) a proximidade ao diff de código
 * existir (Fase 2) e permitir separar "mudou onde o PR mexeu" de "mudou onde
 * ninguém mexeu", ou (b) a medição de corpus mostrar FP visual < 10%.
 */
export const VISUAL_SEVERITY_CEILING = "MEDIUM" as const;
