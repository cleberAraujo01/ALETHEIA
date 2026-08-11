import { describe, expect, it } from "vitest";

import { createLedger } from "./ledger.js";
import { normalizeUrl } from "./url.js";
import { NORMALIZATION_RULES } from "./volatile.js";

const opts = { selfOrigin: "http://localhost:3000" };

describe("normalização de URL por propósito", () => {
  it("alinhamento colapsa identificador de recurso no path", () => {
    const ledger = createLedger();
    expect(normalizeUrl("/orders/1042", opts, ledger)).toBe("/orders/:id");
    expect(normalizeUrl("/orders/1043", opts, ledger)).toBe("/orders/:id");
    expect(ledger.counts()[NORMALIZATION_RULES.NET_PATH_IDENTIFIER]).toBe(2);
  });

  it("valor preserva o identificador — foi o falso negativo do corpus juventude", () => {
    // Um dígito trocado no WhatsApp do clube. Com o path colapsado, base e head
    // ficavam idênticos e o defeito era invisível.
    const ledger = createLedger();
    const value = { ...opts, purpose: "VALUE" as const };
    const antes = normalizeUrl("https://wa.me/5511941126936?text=Ol%C3%A1", value, ledger);
    const depois = normalizeUrl("https://wa.me/5511941126939?text=Ol%C3%A1", value, ledger);

    expect(antes).not.toBe(depois);
    expect(antes).toContain("5511941126936");
  });

  it("origem própria some, origem de terceiro fica", () => {
    const ledger = createLedger();
    expect(normalizeUrl("http://localhost:3000/api/pedidos", opts, ledger)).toBe("/api/pedidos");
    expect(normalizeUrl("https://cdn.terceiro.com/x.js", opts, ledger)).toBe(
      "https://cdn.terceiro.com/x.js",
    );
  });
});

describe("hash de conteúdo de bundle", () => {
  const norm = (url: string, purpose?: "ALIGNMENT" | "VALUE"): string =>
    normalizeUrl(url, purpose === undefined ? opts : { ...opts, purpose }, createLedger());

  it("colapsa o hash mantendo o nome do módulo", () => {
    expect(norm("/_next/static/chunks/app/page-4f2a8c1d9b3e.js")).toBe(
      "/_next/static/chunks/app/page-<hash>.js",
    );
    expect(norm("/assets/index-DkG7f8Xz.js")).toBe("/assets/index-<hash>.js");
    expect(norm("/static/main.a1b2c3d4.css")).toBe("/static/main-<hash>.css");
  });

  it("colapsa também o número de chunk, que é posição no grafo do bundler", () => {
    expect(norm("/_next/static/chunks/528-9d84e3b3ba6f7f01.js")).toBe(
      "/_next/static/chunks/<chunk>-<hash>.js",
    );
  });

  it("módulos diferentes continuam diferentes — sumiço de arquivo ainda aparece", () => {
    expect(norm("/_next/static/chunks/app/layout-aaaa1111.js")).not.toBe(
      norm("/_next/static/chunks/app/page-bbbb2222.js"),
    );
  });

  it("não toca em imagem: trocar a arte é mudança de conteúdo, não de build", () => {
    expect(norm("/banner-paginas-20260811.webp")).toBe("/banner-paginas-20260811.webp");
  });

  it("não toca em arquivo escrito por gente, sem dígito no sufixo", () => {
    expect(norm("/js/plugin.controller.js")).toBe("/js/plugin.controller.js");
  });

  it("vale nos dois propósitos: nome de bundle não é conteúdo de negócio", () => {
    expect(norm("/assets/index-DkG7f8Xz.js", "VALUE")).toBe("/assets/index-<hash>.js");
  });
});
