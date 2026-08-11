/**
 * Alinhamento por identidade semântica — estágio 2 do pipeline (§12.4).
 *
 * "Casa elementos/requests/linhas entre base e head — **não por índice**, por
 * identidade semântica."
 *
 * O alinhamento é feito em passadas de chave, da mais forte para a mais fraca.
 * A ordem importa: casar primeiro pela chave forte evita que um item removido
 * no meio de uma lista desloque todos os seguintes e produza N falsos deltas —
 * o modo clássico de um diff de DOM virar ruído inútil.
 */

export interface AlignedPair<T> {
  readonly base: T;
  readonly head: T;
  readonly baseIndex: number;
  readonly headIndex: number;
  /** Índice da passada de chave que produziu o casamento (0 = mais forte). */
  readonly keyTier: number;
}

export interface Alignment<T> {
  readonly matched: readonly AlignedPair<T>[];
  readonly added: readonly { readonly item: T; readonly index: number }[];
  readonly removed: readonly { readonly item: T; readonly index: number }[];
  /** `true` quando os pares casados aparecem em ordem relativa diferente. */
  readonly reordered: boolean;
}

/**
 * @param keyFns Extratores de chave, do mais forte para o mais fraco.
 *   Retornar `null` significa "esta passada não se aplica a este item".
 */
export function alignByKeys<T>(
  base: readonly T[],
  head: readonly T[],
  keyFns: readonly ((item: T) => string | null)[],
): Alignment<T> {
  const baseTaken = new Array<boolean>(base.length).fill(false);
  const headTaken = new Array<boolean>(head.length).fill(false);
  const matched: AlignedPair<T>[] = [];

  keyFns.forEach((keyFn, keyTier) => {
    const headByKey = new Map<string, number[]>();
    head.forEach((item, index) => {
      if (headTaken[index] === true) return;
      const key = keyFn(item);
      if (key === null) return;
      const bucket = headByKey.get(key);
      if (bucket === undefined) headByKey.set(key, [index]);
      else bucket.push(index);
    });

    base.forEach((item, baseIndex) => {
      if (baseTaken[baseIndex] === true) return;
      const key = keyFn(item);
      if (key === null) return;
      const bucket = headByKey.get(key);
      if (bucket === undefined || bucket.length === 0) return;

      // Dentro da mesma chave, casa por ordem de aparição: é a leitura correta
      // para itens genuinamente repetidos (três `<li>` idênticos, três chamadas
      // ao mesmo endpoint).
      const headIndex = bucket.shift();
      if (headIndex === undefined) return;

      baseTaken[baseIndex] = true;
      headTaken[headIndex] = true;
      const headItem = head[headIndex];
      if (headItem === undefined) return;
      matched.push({ base: item, head: headItem, baseIndex, headIndex, keyTier });
    });
  });

  matched.sort((a, b) => a.baseIndex - b.baseIndex);

  const removed = base
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => baseTaken[index] !== true);
  const added = head
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => headTaken[index] !== true);

  return {
    matched,
    added,
    removed,
    reordered: hasReordering(matched.map((pair) => pair.headIndex)),
  };
}

/**
 * Há reordenação quando os índices em head, lidos na ordem de base, não são
 * crescentes. Usamos o tamanho da maior subsequência crescente para não
 * reportar reordenação em um caso que é, na verdade, um único item movido.
 */
export function hasReordering(headIndices: readonly number[]): boolean {
  return longestIncreasingSubsequenceLength(headIndices) < headIndices.length;
}

export function longestIncreasingSubsequenceLength(values: readonly number[]): number {
  const tails: number[] = [];
  for (const value of values) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((tails[mid] ?? Number.POSITIVE_INFINITY) < value) low = mid + 1;
      else high = mid;
    }
    tails[low] = value;
  }
  return tails.length;
}
