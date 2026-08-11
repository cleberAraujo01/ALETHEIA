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
 * TODO O CONJUNTO DE NÚMEROS ABAIXO É HIPÓTESE, não medição. Nenhum deles saiu
 * de dado real — não existe dado real ainda. O procedimento de validação é o
 * critério de saída da Fase 0: rodar contra aplicação real, triar cada delta
 * como TP ou FP, e ajustar a tabela até chegar a ≥ 5 regressões reais
 * detectadas com < 10% de falso positivo. Enquanto isso não acontecer, tratar
 * qualquer um destes valores como verdade é erro de leitura.
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
