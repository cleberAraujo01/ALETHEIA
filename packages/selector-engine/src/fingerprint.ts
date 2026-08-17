import type { Target } from "@aletheia/ir";

/**
 * Fingerprint ponderado — §12.2 da arquitetura. "Nunca grava um seletor."
 *
 * O `Target` da IR já é o conjunto de sinais; este módulo põe PESO neles. Os
 * pesos são HIPÓTESE declarada (CLAUDE.md §10): partem da estabilidade
 * esperada de cada sinal — quem pôs `data-testid` quis ser achado; papel + nome
 * acessível é o que o usuário percebe; texto muda com copy; CSS estrutural
 * quebra no próximo refactor — e o corpus de mutações do runner mede se a
 * ordem está certa. O `resolvedBy` do trace de cada execução real é a série
 * que vai calibrá-los; nenhum destes números foi ajustado contra dado ainda.
 */

export type Signal = "testId" | "role+name" | "label" | "placeholder" | "text" | "field" | "css";

export const SIGNAL_ORDER: readonly Signal[] = [
  "testId",
  "role+name",
  "label",
  "placeholder",
  "text",
  "field",
  "css",
];

export const DEFAULT_WEIGHTS: Readonly<Record<Signal, number>> = {
  testId: 1.0,
  "role+name": 0.9,
  label: 0.8,
  text: 0.7,
  placeholder: 0.6,
  field: 0.5,
  css: 0.15,
};

/** Um sinal rebaixado por parecer gerado vale isto (nunca zero: ainda vota). */
export const GENERATED_ID_WEIGHT = 0.1;

/**
 * Detector de identificador gerado — o único ponto da §12.2 que "sozinho
 * resolve grande parte das quebras". `mui-4821`, `:r1a:`, `css-1x2y3z`,
 * `sc-bdVaJa`, UUID, hash hexadecimal, sufixo numérico longo: tudo isso muda
 * entre builds sem que nada tenha mudado para o usuário. Um sinal assim não é
 * identidade, é ruído com cara de identidade, e vota com peso simbólico.
 */
export function isGeneratedId(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  return GENERATED_PATTERNS.some((pattern) => pattern.test(trimmed));
}

const GENERATED_PATTERNS: readonly RegExp[] = [
  /^:r[0-9a-z]+:$/i, // React useId
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // UUID
  /(^|[-_])[0-9a-f]{6,}$/i, // hash hexadecimal no fim
  /^(mui|MuiBox|Mui|css|sc|jss|emotion|chakra|mantine|radix|headlessui|rc)[-_][a-z0-9-]+$/i, // css-in-js / libs
  /[-_]\d{3,}$/, // sufixo numérico longo: mui-4821, item-12345
  /^[A-Za-z0-9+/]{16,}={0,2}$/, // base64 comprido
];

export interface WeightedSignal {
  readonly signal: Signal;
  readonly weight: number;
  /** Explicação quando o peso não é o default — vai para o trace. */
  readonly note: string | null;
}

/** Sinais declarados no alvo, com peso — os não declarados não entram. */
export function weightedSignalsOf(
  target: Target,
  weights: Readonly<Record<Signal, number>> = DEFAULT_WEIGHTS,
): readonly WeightedSignal[] {
  const out: WeightedSignal[] = [];
  const push = (signal: Signal, generatedCheck: string | null): void => {
    if (generatedCheck !== null && isGeneratedId(generatedCheck)) {
      out.push({
        signal,
        weight: GENERATED_ID_WEIGHT,
        note: "identificador com cara de gerado — rebaixado",
      });
      return;
    }
    out.push({ signal, weight: weights[signal], note: null });
  };
  if (target.testId !== undefined) push("testId", target.testId);
  if (target.role !== undefined && target.name !== undefined) push("role+name", null);
  if (target.label !== undefined) push("label", null);
  if (target.placeholder !== undefined) push("placeholder", null);
  if (target.text !== undefined) push("text", null);
  if (target.field !== undefined) push("field", target.field);
  if (target.css !== undefined) push("css", cssIdentity(target.css));
  return out;
}

/** O `#id` ou `[data-testid=…]` embutido num CSS, para o detector avaliar. */
function cssIdentity(css: string): string | null {
  const id = /#([A-Za-z0-9_:-]+)/.exec(css);
  if (id?.[1] !== undefined) return id[1];
  const attr = /\[[^\]=]+=["']?([^"'\]]+)["']?\]/.exec(css);
  return attr?.[1] ?? null;
}
