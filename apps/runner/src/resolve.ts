import type { Target } from "@aletheia/ir";
import {
  DEFAULT_CONSENSUS,
  decide,
  weightedSignalsOf,
  type Consensus,
  type Signal,
  type SignalMatches,
} from "@aletheia/selector-engine";
import type { Locator, Page } from "playwright";

/**
 * Resolução de alvo por CONSENSO multi-sinal (§12.2) — a metade com browser.
 *
 * Para cada sinal declarado no fingerprint, um `Locator` do Playwright (a
 * semântica de papel, nome acessível, rótulo e texto é a dele, e é a mesma que
 * o usuário e o leitor de tela percebem). Cada elemento que um sinal casa vira
 * uma chave — o XPath absoluto, calculado dentro da página, sem tocar no DOM
 * (um `data-*` injetado apareceria na captura). O motor soma pesos por chave e
 * decide; este arquivo só coleta e traduz a decisão de volta para um `Locator`.
 *
 * Um sinal que casa muitos elementos é limitado a `MAX_CANDIDATES_PER_SIGNAL`
 * na ordem do documento: 400 candidatos de `text: "Ver"` não vão resolver nada
 * de qualquer jeito, e o custo é por elemento.
 */

const MAX_CANDIDATES_PER_SIGNAL = 25;

export interface Resolution {
  readonly locator: Locator;
  readonly consensus: Extract<Consensus, { kind: "RESOLVED" }>;
  /** Pesos efetivos usados, com nota quando rebaixados (id gerado). */
  readonly signals: readonly { signal: Signal; weight: number; note: string | null }[];
}

export type ResolutionFailure = Exclude<Consensus, { kind: "RESOLVED" }>;

export async function resolveTarget(
  page: Page,
  target: Target,
): Promise<Resolution | ResolutionFailure> {
  const signals = weightedSignalsOf(target);
  const matches: SignalMatches[] = [];

  for (const { signal, weight } of signals) {
    const locator = locatorFor(page, target, signal);
    const count = Math.min(await locator.count(), MAX_CANDIDATES_PER_SIGNAL);
    const keys: string[] = [];
    for (let index = 0; index < count; index += 1) {
      keys.push(await locator.nth(index).evaluate(xpathOf));
    }
    matches.push({ signal, weight, candidateKeys: keys });
  }

  const consensus = decide(
    matches,
    target.nth === undefined ? DEFAULT_CONSENSUS : { ...DEFAULT_CONSENSUS, nth: target.nth },
  );
  if (consensus.kind !== "RESOLVED") return consensus;
  return { locator: page.locator(`xpath=${consensus.key}`), consensus, signals };
}

export function isFailure(value: Resolution | ResolutionFailure): value is ResolutionFailure {
  return !("locator" in value);
}

function locatorFor(page: Page, target: Target, signal: Signal): Locator {
  switch (signal) {
    case "testId": {
      // Os três atributos que `observeFingerprint` lê — `data-testid` (React
      // Testing Library, Playwright), `data-test` (Cypress, Sauce Demo),
      // `data-qa`. Um só `getByTestId` deixaria de fora quem marcou com os
      // outros dois, e o sinal mais forte do fingerprint viraria o mais raro.
      const value = JSON.stringify(target.testId ?? "");
      return page.locator(`[data-testid=${value}], [data-test=${value}], [data-qa=${value}]`);
    }
    case "role+name":
      return page.getByRole(target.role as Parameters<Page["getByRole"]>[0], {
        name: target.name ?? "",
        exact: true,
      });
    case "label":
      return page.getByLabel(target.label ?? "", { exact: true });
    case "placeholder":
      return page.getByPlaceholder(target.placeholder ?? "", { exact: true });
    case "text":
      return page.getByText(target.text ?? "", { exact: true });
    case "field":
      return page.locator(`[name=${JSON.stringify(target.field ?? "")}]`);
    case "css":
      return page.locator(target.css ?? "");
  }
}

/**
 * XPath absoluto — identidade do elemento DENTRO desta página, nesta captura.
 * Não é seletor gravado em lugar nenhum: vive só o tempo da resolução.
 * Roda no browser.
 */
function xpathOf(element: Element): string {
  const parts: string[] = [];
  let node: Element | null = element;
  while (node !== null && node.nodeType === 1) {
    let index = 1;
    let sibling = node.previousElementSibling;
    while (sibling !== null) {
      if (sibling.tagName === node.tagName) index += 1;
      sibling = sibling.previousElementSibling;
    }
    parts.unshift(`${node.tagName.toLowerCase()}[${index}]`);
    node = node.parentElement;
  }
  return `/${parts.join("/")}`;
}

/**
 * O que o elemento resolvido diz de si — para a proposta de cura substituir os
 * sinais que falharam pelo que existe de fato. Roda no browser; só lê.
 */
export async function observeFingerprint(locator: Locator): Promise<Partial<Target>> {
  return locator.evaluate((element: Element): Partial<Target> => {
    const observed: Record<string, string> = {};
    const testId =
      element.getAttribute("data-testid") ??
      element.getAttribute("data-test") ??
      element.getAttribute("data-qa");
    if (testId !== null && testId.length > 0) observed["testId"] = testId;
    const placeholder = element.getAttribute("placeholder");
    if (placeholder !== null && placeholder.length > 0) observed["placeholder"] = placeholder;
    const field = element.getAttribute("name");
    if (field !== null && field.length > 0) observed["field"] = field;
    const text = element.textContent.replace(/\s+/g, " ").trim();
    if (text.length > 0 && text.length <= 80) observed["text"] = text;
    const role = element.getAttribute("role") ?? implicitRole(element);
    const name = element.getAttribute("aria-label") ?? (text.length > 0 ? text : null);
    if (role !== null && name !== null) {
      observed["role"] = role;
      observed["name"] = name;
    }
    const id = element.getAttribute("id");
    if (id !== null && id.length > 0) {
      const label = element.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
      const labelText = (label?.textContent ?? "").replace(/\s+/g, " ").trim();
      if (labelText.length > 0) observed["label"] = labelText;
    }
    return observed;

    function implicitRole(node: Element): string | null {
      const tag = node.tagName.toLowerCase();
      if (tag === "button") return "button";
      if (tag === "a" && node.hasAttribute("href")) return "link";
      if (tag === "select") return "combobox";
      if (tag === "textarea") return "textbox";
      if (tag === "input") {
        const type = (node.getAttribute("type") ?? "text").toLowerCase();
        if (["submit", "button", "reset"].includes(type)) return "button";
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        return "textbox";
      }
      return null;
    }
  });
}
