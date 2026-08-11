/**
 * Serialização do DOM — roda **dentro da página**.
 *
 * Precisa ser autocontida: é enviada ao browser e avaliada lá, sem acesso a
 * nada do escopo do Node.
 *
 * Sobre papel e nome acessível: o correto é a árvore AX via CDP
 * (`Accessibility.getFullAXTree`), como diz a ADR-002. O que existe aqui é uma
 * aproximação — mapa de papéis implícitos e cálculo simplificado de nome. Ela
 * cobre os casos que dominam identidade de elemento (botão, link, campo,
 * cabeçalho) e é determinística, mas diverge do computado pelo browser em
 * casos de `aria-labelledby` encadeado e conteúdo gerado por CSS.
 *
 * Isso importa porque papel e nome são sinais de **identidade** no alinhamento:
 * uma aproximação ruim não gera delta errado, gera casamento errado — que é
 * pior, porque vira delta errado depois. Substituir por AX tree real é o
 * primeiro upgrade desta camada.
 */

export interface SerializedNode {
  tag: string;
  attributes: Record<string, string>;
  text: string | null;
  role: string | null;
  accessibleName: string | null;
  children: SerializedNode[];
}

export function serializeDomInPage(): SerializedNode | null {
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "LINK", "META"]);
  const MAX_NAME_LENGTH = 200;

  const IMPLICIT_ROLES: Record<string, string> = {
    A: "link",
    ARTICLE: "article",
    ASIDE: "complementary",
    BUTTON: "button",
    DIALOG: "dialog",
    FIGURE: "figure",
    FOOTER: "contentinfo",
    FORM: "form",
    H1: "heading",
    H2: "heading",
    H3: "heading",
    H4: "heading",
    H5: "heading",
    H6: "heading",
    HEADER: "banner",
    IMG: "img",
    LI: "listitem",
    MAIN: "main",
    NAV: "navigation",
    OL: "list",
    OPTION: "option",
    PROGRESS: "progressbar",
    SECTION: "region",
    SELECT: "combobox",
    TABLE: "table",
    TBODY: "rowgroup",
    TD: "cell",
    TEXTAREA: "textbox",
    TH: "columnheader",
    TR: "row",
    UL: "list",
  };

  const INPUT_ROLES: Record<string, string> = {
    button: "button",
    checkbox: "checkbox",
    email: "textbox",
    number: "spinbutton",
    password: "textbox",
    radio: "radio",
    range: "slider",
    reset: "button",
    search: "searchbox",
    submit: "button",
    tel: "textbox",
    text: "textbox",
    url: "textbox",
  };

  const NAME_FROM_CONTENT = new Set([
    "button",
    "link",
    "heading",
    "listitem",
    "option",
    "cell",
    "columnheader",
  ]);

  function roleOf(element: Element): string | null {
    const explicit = element.getAttribute("role");
    if (explicit !== null && explicit.trim().length > 0) return explicit.trim().split(/\s+/)[0] ?? null;
    if (element.tagName === "A") return element.hasAttribute("href") ? "link" : null;
    if (element.tagName === "INPUT") {
      const type = (element.getAttribute("type") ?? "text").toLowerCase();
      return INPUT_ROLES[type] ?? "textbox";
    }
    return IMPLICIT_ROLES[element.tagName] ?? null;
  }

  function clean(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const collapsed = value.replace(/\s+/g, " ").trim();
    if (collapsed.length === 0) return null;
    return collapsed.length > MAX_NAME_LENGTH ? collapsed.slice(0, MAX_NAME_LENGTH) : collapsed;
  }

  function accessibleNameOf(element: Element, role: string | null): string | null {
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy !== null) {
      const parts = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .filter((part) => part.length > 0);
      const joined = clean(parts.join(" "));
      if (joined !== null) return joined;
    }

    const ariaLabel = clean(element.getAttribute("aria-label"));
    if (ariaLabel !== null) return ariaLabel;

    if (element.tagName === "IMG") {
      const alt = clean(element.getAttribute("alt"));
      if (alt !== null) return alt;
    }

    if (element.tagName === "INPUT" || element.tagName === "SELECT" || element.tagName === "TEXTAREA") {
      const id = element.getAttribute("id");
      if (id !== null && id.length > 0) {
        const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        const fromLabel = clean(label?.textContent);
        if (fromLabel !== null) return fromLabel;
      }
      const wrapping = clean(element.closest("label")?.textContent);
      if (wrapping !== null) return wrapping;
      const placeholder = clean(element.getAttribute("placeholder"));
      if (placeholder !== null) return placeholder;
    }

    if (role !== null && NAME_FROM_CONTENT.has(role)) {
      const fromContent = clean(element.textContent);
      if (fromContent !== null) return fromContent;
    }

    return clean(element.getAttribute("title"));
  }

  /** Texto que pertence ao próprio nó — não o dos descendentes. */
  function directTextOf(element: Element): string | null {
    let text = "";
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) text += node.nodeValue ?? "";
    }
    return clean(text);
  }

  function serialize(element: Element): SerializedNode {
    const attributes: Record<string, string> = {};
    for (const attribute of Array.from(element.attributes)) {
      attributes[attribute.name] = attribute.value;
    }

    const role = roleOf(element);
    // Conteúdo interno de SVG é ruído de altíssimo volume (centenas de `path`
    // com coordenadas) e valor de identidade nulo. O elemento entra; os filhos
    // não. É omissão declarada, não silenciosa.
    const isSvg = element.tagName.toLowerCase() === "svg";

    const children: SerializedNode[] = [];
    if (!isSvg) {
      for (const child of Array.from(element.children)) {
        if (SKIP_TAGS.has(child.tagName)) continue;
        children.push(serialize(child));
      }
    }

    return {
      tag: element.tagName.toLowerCase(),
      attributes,
      text: directTextOf(element),
      role,
      accessibleName: accessibleNameOf(element, role),
      children,
    };
  }

  return document.body === null ? null : serialize(document.body);
}
