import { describe, expect, it } from "vitest";

import { normalizeDom } from "../normalize/dom.js";
import { createLedger } from "../normalize/ledger.js";
import type { DomNode } from "../types/capture.js";

import { diffDom } from "./dom.js";
import { DeltaBudget, type RawDelta } from "./types.js";

const opts = { selfOrigin: "http://127.0.0.1:3201" };

const node = (tag: string, text: string | null, children: DomNode[] = []): DomNode => ({
  tag,
  attributes: {},
  text,
  role: null,
  accessibleName: null,
  children,
});

const removals = (base: DomNode, head: DomNode): RawDelta[] =>
  diffDom(
    "obs",
    normalizeDom(base, opts, createLedger()),
    normalizeDom(head, opts, createLedger()),
    new DeltaBudget(500),
  ).filter((delta) => delta.kind === "DOM_NODE_REMOVED");

/**
 * A distinção que estes casos protegem vale o produto: suprimir remoção porque
 * "o texto está por aí" seria criar falso negativo para curar falso positivo.
 */
describe("remoção de nó: conteúdo perdido × conteúdo reembalado", () => {
  it("texto que sobe um nível é reembalagem", () => {
    // Commit real `1f2772c4b` do django-oscar: `<p><i/> Unavailable</p>` vira
    // `<i/>` mais o texto solto no pai. A página não muda para quem olha.
    const base = node("div", null, [
      node("p", null, [node("i", null), node("span", "Unavailable")]),
    ]);
    const head = node("div", "Unavailable", [node("i", null)]);

    const [delta] = removals(base, head);
    expect(delta?.facts["carriesText"]).toBe(true);
    expect(delta?.facts["textPreserved"]).toBe(true);
  });

  it("item que some de uma listagem continua sendo perda de conteúdo", () => {
    // Defeito `O6-listagem-off-by-one`: o último produto some. Os irmãos
    // compartilham quase todo o texto — só o título é próprio, e é por isso que
    // a comparação é de texto COMPLETO e não de trecho.
    const produto = (titulo: string): DomNode =>
      node("li", null, [node("h3", titulo), node("span", "£8.99 In stock Add to basket")]);
    const base = node("ol", null, [produto("Snow Crash"), produto("Galatea 2.2")]);
    const head = node("ol", null, [produto("Snow Crash")]);

    const [delta] = removals(base, head);
    expect(delta?.facts["carriesText"]).toBe(true);
    expect(delta?.facts["textPreserved"]).toBe(false);
  });

  it("link que some do menu não é reembalagem — o texto foi embora", () => {
    // Mudança intencional `M1`: o menu passa a listar só o primeiro nível.
    const base = node("div", null, [node("a", "Books"), node("a", "Fiction")]);
    const head = node("div", null, [node("a", "Books")]);

    const [delta] = removals(base, head);
    expect(delta?.facts["textPreserved"]).toBe(false);
  });

  it("invólucro vazio que some não vira reembalagem por falta de texto", () => {
    const base = node("div", null, [node("span", "fica"), node("div", null)]);
    const head = node("div", null, [node("span", "fica")]);

    const [delta] = removals(base, head);
    expect(delta?.facts["carriesText"]).toBe(false);
    expect(delta?.facts["textPreserved"]).toBe(false);
  });
});

/**
 * `textFallback` é o que separa "o rótulo mudou" de "o elemento ficou anônimo".
 * Sem ele a severidade teria de perguntar QUAL atributo sumiu — que é
 * exatamente a pergunta que o defeito `O7` mostrou ser a errada.
 */
describe("nome acessível perdido: sobrou texto para anunciar?", () => {
  const named = (
    tag: string,
    accessibleName: string | null,
    text: string | null = null,
  ): DomNode => ({ ...node(tag, text), role: tag === "img" ? "img" : "link", accessibleName });

  const nameDeltas = (base: DomNode, head: DomNode): RawDelta[] =>
    diffDom(
      "obs",
      normalizeDom(base, opts, createLedger()),
      normalizeDom(head, opts, createLedger()),
      new DeltaBudget(500),
    ).filter((delta) => delta.kind === "DOM_ACCESSIBLE_NAME_CHANGED");

  it("imagem que perde o alt não tem para onde cair", () => {
    // Defeito `O7`: a miniatura do produto perde `alt` nas listagens.
    const [delta] = nameDeltas(named("img", "Applied cryptography"), named("img", null));
    expect(delta?.after).toBeNull();
    expect(delta?.facts["textFallback"]).toBe(false);
  });

  it("link que perde o aria-label mas mantém o texto continua anunciável", () => {
    const [delta] = nameDeltas(
      named("a", "Ver todas as turmas", "Ver turmas"),
      named("a", null, "Ver turmas"),
    );
    expect(delta?.facts["textFallback"]).toBe(true);
  });
});
