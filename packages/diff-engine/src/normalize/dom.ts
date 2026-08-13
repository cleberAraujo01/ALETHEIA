import { stableHash } from "@aletheia/shared";

import type { DomNode } from "../types/capture.js";
import type { NormalizationLedger } from "./ledger.js";
import { normalizeUrl, type UrlNormalizationOptions } from "./url.js";
import {
  NORMALIZATION_RULES,
  PLACEHOLDER,
  collapseWhitespace,
  isFrameworkAttribute,
  isGeneratedIdentifier,
  isHashedClassName,
  isOpaqueToken,
  isTokenFieldName,
} from "./volatile.js";

/**
 * Atributos que carregam identidade estável de um elemento. São a base do
 * alinhamento semântico do estágio 2 — nunca `class`, nunca posição.
 */
const IDENTITY_ATTRIBUTES = [
  "data-testid",
  "data-test",
  "data-qa",
  "data-cy",
  "id",
  "name",
  "type",
  "href",
  "src",
  "alt",
  "placeholder",
  "aria-label",
  "for",
] as const;

/** Atributos cujo valor é uma URL e portanto passa pela normalização de URL. */
const URL_ATTRIBUTES = new Set(["href", "src", "action", "srcset", "poster"]);

export interface NormalizedDomNode {
  readonly tag: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly text: string | null;
  readonly role: string | null;
  readonly accessibleName: string | null;
  readonly children: readonly NormalizedDomNode[];
  /**
   * Identidade incluindo o texto próprio. Casa "o mesmo elemento com o mesmo
   * conteúdo" — resolve bem remoção de item em lista.
   */
  readonly strongKey: string;
  /**
   * Identidade ignorando o texto. Casa "o mesmo elemento" mesmo que o conteúdo
   * tenha mudado — é o que transforma um par remoção+adição num
   * `DOM_TEXT_CHANGED`, que é a leitura correta.
   */
  readonly weakKey: string;
  /** Hash da subárvore inteira. Igualdade permite podar a descida (§12.4). */
  readonly subtreeHash: string;
  readonly subtreeSize: number;
}

export function normalizeDom(
  node: DomNode,
  urlOptions: UrlNormalizationOptions,
  ledger: NormalizationLedger,
): NormalizedDomNode {
  const attributes = normalizeAttributes(node.attributes, urlOptions, ledger);
  const text = normalizeText(node.text, ledger);
  const role = node.role;
  const accessibleName = node.accessibleName === null ? null : collapseWhitespace(node.accessibleName);
  const children = node.children.map((child) => normalizeDom(child, urlOptions, ledger));

  const identity = {
    tag: node.tag.toLowerCase(),
    role,
    accessibleName,
    attributes: pickIdentityAttributes(attributes),
  };

  const weakKey = stableHash(identity);
  const strongKey = stableHash({ ...identity, text });
  const subtreeHash = stableHash({
    tag: identity.tag,
    role,
    accessibleName,
    attributes,
    text,
    children: children.map((child) => child.subtreeHash),
  });

  return {
    tag: identity.tag,
    attributes,
    text,
    role,
    accessibleName,
    children,
    strongKey,
    weakKey,
    subtreeHash,
    subtreeSize: 1 + children.reduce((sum, child) => sum + child.subtreeSize, 0),
  };
}

function normalizeText(text: string | null, ledger: NormalizationLedger): string | null {
  if (text === null) return null;
  const collapsed = collapseWhitespace(text);
  if (collapsed !== text) {
    ledger.record(NORMALIZATION_RULES.DOM_WHITESPACE);
  }
  return collapsed.length === 0 ? null : collapsed;
}

function normalizeAttributes(
  attributes: Readonly<Record<string, string>>,
  urlOptions: UrlNormalizationOptions,
  ledger: NormalizationLedger,
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};

  for (const name of Object.keys(attributes).sort()) {
    const raw = attributes[name];
    if (raw === undefined) continue;

    if (isFrameworkAttribute(name)) {
      ledger.record(NORMALIZATION_RULES.DOM_FRAMEWORK_ATTRIBUTE);
      continue;
    }

    if (name === "class") {
      result[name] = normalizeClassList(raw, ledger);
      continue;
    }

    // Token anti-CSRF em campo escondido. Conjunção de três condições: é o
    // `value`, o `name` do campo é de token conhecido de framework, e o valor
    // tem forma opaca. Campo de negócio com valor legível continua comparado.
    if (
      name === "value" &&
      isTokenFieldName(attributes["name"] ?? "") &&
      isOpaqueToken(raw)
    ) {
      ledger.record(NORMALIZATION_RULES.DOM_TOKEN_FIELD_VALUE);
      result[name] = PLACEHOLDER.TOKEN;
      continue;
    }

    if (URL_ATTRIBUTES.has(name)) {
      // `VALUE`: aqui a URL é o conteúdo comparado, não a chave de
      // emparelhamento — o nó já foi emparelhado pela estrutura. Ver
      // `UrlNormalizationOptions.purpose`.
      result[name] = normalizeUrl(raw, { ...urlOptions, purpose: "VALUE" }, ledger);
      continue;
    }

    if (isGeneratedIdentifier(raw)) {
      ledger.record(NORMALIZATION_RULES.DOM_GENERATED_ATTRIBUTE_VALUE);
      result[name] = PLACEHOLDER.GENERATED;
      continue;
    }

    result[name] = collapseWhitespace(raw);
  }

  return result;
}

function normalizeClassList(raw: string, ledger: NormalizationLedger): string {
  const classes = raw.split(/\s+/).filter((entry) => entry.length > 0);
  const mapped = classes.map((entry) => {
    if (isHashedClassName(entry) || isGeneratedIdentifier(entry)) {
      ledger.record(NORMALIZATION_RULES.DOM_HASHED_CLASS);
      return PLACEHOLDER.HASHED;
    }
    return entry;
  });

  const sorted = [...mapped].sort();
  if (sorted.some((entry, index) => mapped[index] !== entry)) {
    ledger.record(NORMALIZATION_RULES.DOM_CLASS_ORDER);
  }

  // Placeholders repetidos não carregam informação; um basta.
  return [...new Set(sorted)].join(" ");
}

function pickIdentityAttributes(
  attributes: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const picked: Record<string, string> = {};
  for (const name of IDENTITY_ATTRIBUTES) {
    const value = attributes[name];
    // Um id gerado não identifica nada entre duas builds — vira ruído de chave.
    if (value !== undefined && value !== PLACEHOLDER.GENERATED) {
      picked[name] = value;
    }
  }
  return picked;
}

/** Rótulo legível de um nó, usado nos caminhos do relatório. */
export function describeNode(node: NormalizedDomNode): string {
  const testid =
    node.attributes["data-testid"] ?? node.attributes["data-test"] ?? node.attributes["data-qa"];
  if (testid !== undefined) return `${node.tag}[data-testid="${testid}"]`;
  if (node.role !== null && node.accessibleName !== null) {
    return `${node.tag}[role=${node.role} "${node.accessibleName}"]`;
  }
  if (node.accessibleName !== null) return `${node.tag}["${node.accessibleName}"]`;
  const id = node.attributes["id"];
  if (id !== undefined && id !== PLACEHOLDER.GENERATED) return `${node.tag}#${id}`;
  return node.tag;
}
