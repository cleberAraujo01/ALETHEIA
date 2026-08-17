/**
 * IR v1 — Representação Intermediária de jornada (§12.1 da arquitetura).
 *
 * "Código é projeção descartável da IR, nunca a fonte da verdade." A IR é
 * declarativa, versionada, diffável em PR, e o runner a INTERPRETA — não gera
 * código a partir dela. Este é o schema mínimo que a Fase 1 precisa: navegar,
 * agir num elemento, observar. Cada coisa que não está aqui (pré-condições de
 * massa, `assert.reconcile`, teardown) está fora porque a fatia que a usa ainda
 * não existe, e um campo sem consumidor é promessa.
 *
 * SOBRE O ALVO (`Target`). A arquitetura resolve `targetRef` num repositório de
 * elementos por consenso multi-sinal (E-05, motor de seletores). Antes disso,
 * o alvo é INLINE e já é um fingerprint: vários sinais, nenhum deles um
 * seletor CSS sozinho (§3.5 do CLAUDE.md — "nunca seletor único"). Quando o
 * E-05 existir, o `Target` inline vira a entrada do repositório e o `targetRef`
 * a referência; o formato dos sinais é o mesmo, de propósito.
 *
 * SOBRE SEGREDO. `fill` aceita `{ secretRef }`: o nome de uma variável de
 * ambiente. O valor nunca aparece na IR, no trace, no log nem na captura —
 * o runner o mascara onde ele reaparecer (PA-09).
 */

export const IR_VERSION = "1.0.0";

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/**
 * Fingerprint multi-sinal de um elemento. Pelo menos um sinal SEMÂNTICO
 * (`testId`, `role`+`name`, `label`, `placeholder`, `text`, `field`) é obrigatório;
 * `css` é complemento declarado, nunca o único sinal.
 */
export interface Target {
  readonly testId?: string;
  /** Papel ARIA (`button`, `link`, `textbox`…). Combina com `name`. */
  readonly role?: string;
  readonly name?: string;
  readonly label?: string;
  readonly placeholder?: string;
  readonly text?: string;
  /** Atributo `name` de campo de formulário — o contrato do POST, estável por natureza. */
  readonly field?: string;
  readonly css?: string;
  /** Desempate explícito quando o fingerprint casa mais de um elemento. */
  readonly nth?: number;
}

/**
 * Referência ao repositório de elementos (§12.3): o fingerprint mora lá, a
 * jornada só aponta. Corrigir num lugar propaga para toda jornada que usa o
 * ref. `el_<slug>`.
 */
export interface TargetRef {
  readonly ref: string;
}

/** Alvo de um passo: fingerprint inline, ou referência ao repositório. */
export type TargetSpec = Target | TargetRef;

export function isTargetRef(target: TargetSpec): target is TargetRef {
  return "ref" in target;
}

export type IrValue = string | { readonly secretRef: string };

export type IrStep =
  | { readonly id: string; readonly action: "navigate"; readonly path: string }
  | { readonly id: string; readonly action: "click"; readonly target: TargetSpec }
  | {
      readonly id: string;
      readonly action: "fill";
      readonly target: TargetSpec;
      readonly value: IrValue;
    }
  | {
      readonly id: string;
      readonly action: "select";
      readonly target: TargetSpec;
      readonly value: string;
    }
  | {
      readonly id: string;
      readonly action: "press";
      readonly key: string;
      readonly target?: TargetSpec;
    }
  | {
      readonly id: string;
      readonly action: "observe";
      /** Chave semântica de alinhamento entre base e head. */
      readonly observationId: string;
      /** Regiões sabidamente dinâmicas, excluídas da comparação visual. */
      readonly masks: readonly Rect[];
    };

export type IrAction = IrStep["action"];

export const IR_ACTIONS: readonly IrAction[] = [
  "navigate",
  "click",
  "fill",
  "select",
  "press",
  "observe",
];

export interface IrJourney {
  readonly irVersion: typeof IR_VERSION;
  /** `jr_<slug>`. Estável entre execuções: identifica a jornada, não a rodada. */
  readonly id: string;
  readonly name: string;
  readonly viewport: Viewport;
  readonly steps: readonly IrStep[];
}
