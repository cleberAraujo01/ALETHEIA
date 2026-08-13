import { describe, expect, it } from "vitest";

import type { DomNode } from "../types/capture.js";

import { normalizeDom } from "./dom.js";
import { createLedger } from "./ledger.js";
import { NORMALIZATION_RULES } from "./volatile.js";

const opts = { selfOrigin: "http://127.0.0.1:3201" };

const input = (attributes: Record<string, string>): DomNode => ({
  tag: "input",
  attributes,
  text: null,
  role: null,
  accessibleName: null,
  children: [],
});

const attrs = (node: DomNode): Readonly<Record<string, string>> =>
  normalizeDom(node, opts, createLedger()).attributes;

/**
 * Terceira aplicação desconhecida: sandbox do django-oscar. Duas capturas da
 * MESMA build produziram 104 deltas, 95 deles o token de CSRF — um por
 * formulário, em nove páginas.
 */
describe("token de campo de formulário", () => {
  const A = "LtrdNuoEaklAwDNFR3AY8AJTGVNNzZuaCUL2ClccGleREO1j2ExJhR8g1uKjpGLF";
  const B = "9WaexTUdjZxQEETTmiReJ9vIJtiHs0yRRkkCZIuzZ6vUtqWDcShguViTy4T7K59I";

  const csrf = (value: string): Readonly<Record<string, string>> =>
    attrs(input({ type: "hidden", name: "csrfmiddlewaretoken", value }));

  it("csrfmiddlewaretoken do Django sai do diff", () => {
    expect(csrf(A)).toEqual(csrf(B));
    expect(csrf(A)["value"]).toBe("<token>");
  });

  it("conta no ledger — normalização nunca é silenciosa", () => {
    const ledger = createLedger();
    normalizeDom(input({ name: "csrfmiddlewaretoken", value: A }), opts, ledger);
    expect(ledger.counts()[NORMALIZATION_RULES.DOM_TOKEN_FIELD_VALUE]).toBe(1);
  });

  it("cobre o campo equivalente de Rails e ASP.NET", () => {
    expect(attrs(input({ name: "authenticity_token", value: A }))["value"]).toBe("<token>");
    expect(attrs(input({ name: "__RequestVerificationToken", value: A }))["value"]).toBe("<token>");
  });

  it("campo de negócio com valor opaco continua sendo comparado", () => {
    // A conjunção existe por isto: o valor sozinho não autoriza apagar nada.
    expect(attrs(input({ name: "cupom", value: A }))["value"]).toBe(A);
    expect(attrs(input({ name: "cupom", value: A }))["value"]).not.toBe(
      attrs(input({ name: "cupom", value: B }))["value"],
    );
  });

  it("campo de token com valor legível continua sendo comparado", () => {
    // Sem a exigência de forma opaca, um `value` curto e significativo sumiria.
    expect(attrs(input({ name: "csrf", value: "off" }))["value"]).toBe("off");
  });

  it("`token` sozinho não entra na lista — é nome plausível de campo de negócio", () => {
    expect(attrs(input({ name: "token", value: A }))["value"]).toBe(A);
  });

  it("não confunde `value` de outro elemento sem campo `name`", () => {
    expect(attrs(input({ value: A }))["value"]).toBe(A);
  });
});
