import { describe, expect, it } from "vitest";

import { alignByKeys, longestIncreasingSubsequenceLength } from "./generic.js";

interface Item {
  readonly id: string;
  readonly text: string;
}

const strong = (item: Item): string => `${item.id}|${item.text}`;
const weak = (item: Item): string => item.id;

describe("alinhamento por identidade semântica", () => {
  it("remover um item do meio não desloca os seguintes", () => {
    // É este caso que separa um diff útil de um diff inútil: casar por índice
    // produziria 1 remoção + N alterações em cascata.
    const base: Item[] = [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
      { id: "c", text: "C" },
      { id: "d", text: "D" },
    ];
    const head = base.filter((item) => item.id !== "b");

    const alignment = alignByKeys(base, head, [strong, weak]);

    expect(alignment.matched).toHaveLength(3);
    expect(alignment.removed.map(({ item }) => item.id)).toEqual(["b"]);
    expect(alignment.added).toHaveLength(0);
    expect(alignment.reordered).toBe(false);
  });

  it("conteúdo alterado casa pela chave fraca em vez de virar remoção + adição", () => {
    const base: Item[] = [{ id: "a", text: "R$ 85,00" }];
    const head: Item[] = [{ id: "a", text: "R$ 90,00" }];

    const alignment = alignByKeys(base, head, [strong, weak]);

    expect(alignment.matched).toHaveLength(1);
    expect(alignment.matched[0]?.keyTier).toBe(1);
    expect(alignment.removed).toHaveLength(0);
    expect(alignment.added).toHaveLength(0);
  });

  it("itens repetidos idênticos casam por ordem de aparição", () => {
    const base: Item[] = [
      { id: "x", text: "T" },
      { id: "x", text: "T" },
      { id: "x", text: "T" },
    ];
    const head: Item[] = [
      { id: "x", text: "T" },
      { id: "x", text: "T" },
    ];

    const alignment = alignByKeys(base, head, [strong, weak]);

    expect(alignment.matched).toHaveLength(2);
    expect(alignment.removed).toHaveLength(1);
  });

  it("detecta reordenação real", () => {
    const base: Item[] = [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
      { id: "c", text: "C" },
    ];
    const head: Item[] = [base[2], base[0], base[1]].filter(
      (item): item is Item => item !== undefined,
    );

    const alignment = alignByKeys(base, head, [strong, weak]);

    expect(alignment.matched).toHaveLength(3);
    expect(alignment.reordered).toBe(true);
  });

  it("não acusa reordenação quando a ordem se manteve", () => {
    expect(longestIncreasingSubsequenceLength([0, 1, 2, 3])).toBe(4);
    expect(longestIncreasingSubsequenceLength([2, 0, 1])).toBe(2);
  });
});
