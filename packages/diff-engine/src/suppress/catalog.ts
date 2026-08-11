import type { SuppressionRule } from "./rule.js";

/**
 * Catálogo de regras de supressão.
 *
 * **Está vazio de propósito, e isso não é uma pendência.**
 *
 * O procedimento de §6.4 do CLAUDE.md exige, para cada regra: 3 casos reais
 * rotulados como NOISE, um caso de regressão em `__fixtures__/`, e medição de
 * impacto no corpus de referência antes e depois — nenhuma regra pode reduzir
 * a detecção verdadeira.
 *
 * Não existe corpus ainda. Escrever regras agora seria adivinhar o que é ruído
 * na aplicação de um cliente que não observamos, e cada palpite errado é uma
 * regressão que o produto deixa de ver para sempre — sem nunca avisar.
 *
 * A ordem correta é: rodar contra uma aplicação real, triar os deltas, rotular
 * os NOISE, e só então converter os padrões recorrentes em regras com
 * evidência anexada. É literalmente o critério de saída da Fase 0.
 *
 * O ruído *estrutural* (id gerado, ordem de classe, timestamp, token) já é
 * tratado em `../normalize/`, que é outro estágio, com outra justificativa.
 */
export const SUPPRESSION_CATALOG: readonly SuppressionRule[] = [];
