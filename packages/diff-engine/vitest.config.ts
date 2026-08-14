import { defineConfig } from "vitest/config";

/**
 * Cobertura é POR PACOTE, nunca agregada no monorepo.
 *
 * Número global de cobertura mistura o que precisa de 90% com o que não precisa
 * de nada, e a média esconde exatamente o buraco que interessa. Aqui o pacote
 * que concentra o risco de falso positivo do produto responde pelo próprio
 * número.
 *
 * SEM LIMIAR DE FALHA por enquanto, e isso é deliberado: um limiar inventado
 * agora seria número sem evidência (CLAUDE.md §10). A cobertura é medida e
 * publicada; o limiar entra quando houver série histórica para ancorá-lo.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/index.ts"],
    },
  },
});
