import type { Target } from "@aletheia/ir";
import type { Locator, Page } from "playwright";

/**
 * Resolução de alvo por fingerprint — a versão de UM sinal por vez do que o
 * motor de seletores (E-05) vai fazer por consenso.
 *
 * A ordem é a da estabilidade do sinal, do mais deliberado ao mais frágil:
 * `data-testid` (alguém pôs ali para ser achado), papel + nome acessível (o
 * que o usuário percebe), rótulo de formulário, placeholder, texto, e por
 * último CSS — que só existe como complemento (o validador da IR recusa CSS
 * sozinho, §3.5). O primeiro sinal que casa EXATAMENTE UM elemento resolve;
 * `nth` desempata quando o autor sabe que há vários.
 *
 * O sinal que resolveu vai para o trace (`resolvedBy`). Quando o E-05 chegar,
 * é essa coluna que diz quais sinais concordam entre si numa aplicação real —
 * a calibração do consenso vem daqui, não de palpite.
 */

export interface Resolution {
  readonly locator: Locator;
  readonly resolvedBy: string;
}

export type ResolutionFailure =
  | { readonly kind: "not-found"; readonly tried: readonly string[] }
  | {
      readonly kind: "ambiguous";
      readonly tried: readonly string[];
      readonly counts: Readonly<Record<string, number>>;
    };

export async function resolveTarget(
  page: Page,
  target: Target,
): Promise<Resolution | ResolutionFailure> {
  const candidates = candidatesOf(page, target);
  const tried: string[] = [];
  const counts: Record<string, number> = {};

  for (const { signal, locator } of candidates) {
    tried.push(signal);
    const count = await locator.count();
    counts[signal] = count;
    if (count === 0) continue;
    if (target.nth !== undefined) {
      if (target.nth < count)
        return { locator: locator.nth(target.nth), resolvedBy: `${signal}[${target.nth}]` };
      continue;
    }
    if (count === 1) return { locator: locator.first(), resolvedBy: signal };
  }

  const anyMatch = Object.values(counts).some((count) => count > 0);
  return anyMatch ? { kind: "ambiguous", tried, counts } : { kind: "not-found", tried };
}

function candidatesOf(page: Page, target: Target): { signal: string; locator: Locator }[] {
  const out: { signal: string; locator: Locator }[] = [];
  if (target.testId !== undefined)
    out.push({ signal: "testId", locator: page.getByTestId(target.testId) });
  if (target.role !== undefined && target.name !== undefined) {
    out.push({
      signal: "role+name",
      locator: page.getByRole(target.role as Parameters<Page["getByRole"]>[0], {
        name: target.name,
        exact: true,
      }),
    });
  }
  if (target.label !== undefined)
    out.push({ signal: "label", locator: page.getByLabel(target.label, { exact: true }) });
  if (target.placeholder !== undefined) {
    out.push({
      signal: "placeholder",
      locator: page.getByPlaceholder(target.placeholder, { exact: true }),
    });
  }
  if (target.text !== undefined)
    out.push({ signal: "text", locator: page.getByText(target.text, { exact: true }) });
  if (target.css !== undefined) out.push({ signal: "css", locator: page.locator(target.css) });
  return out;
}

export function isFailure(value: Resolution | ResolutionFailure): value is ResolutionFailure {
  return "kind" in value;
}
