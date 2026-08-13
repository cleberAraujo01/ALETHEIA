import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import importX from "eslint-plugin-import-x";
import promise from "eslint-plugin-promise";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Lint deste repositório.
 *
 * A régua para uma regra entrar aqui é a mesma que aplicamos ao produto: ela
 * precisa pegar uma classe de defeito que nenhuma outra pega, e não pode
 * reprovar quem não errou. Regra que dispara em código correto treina o time a
 * ignorar vermelho — e um time que ignora gate vermelho é exatamente o que este
 * produto não pode produzir no cliente (PA-10, §10.6 da medição).
 *
 * Tudo aqui é type-aware. Sem informação de tipo, metade do que importa neste
 * repositório — promessa solta, união mal estreitada, `unknown` usado como
 * `any` — passa batido.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      ".aletheia/**",
      // Corpus é dado de medição, não código do produto.
      "packages/diff-engine/__fixtures__/**",
      "packages/diff-engine/__corpus__/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,

  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.lint.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      // Sem resolver, `no-cycle` e `no-unresolved` não conseguem seguir um
      // import e reportam TUDO como não resolvido.
      "import-x/resolver-next": [
        createTypeScriptImportResolver({ project: ["./tsconfig.lint.json"] }),
      ],
    },
    plugins: { promise },
    rules: {
      ...promise.configs.recommended.rules,

      // `tsc --noEmit` já falha em import que não resolve, e roda no mesmo CI.
      // Manter as duas é pagar duas vezes pela mesma cobertura — e a versão do
      // ESLint erra mais, porque depende de um resolver próprio.
      "import-x/no-unresolved": "off",

      // Interpolar número em template é seguro e universal: `${42}` não tem
      // ambiguidade nenhuma. A regra fica LIGADA para o que de fato queima —
      // `any`, `null` e `undefined` virando a string "undefined" dentro de um
      // relatório que alguém vai ler como veredito.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],

      // ---------------------------------------------------------------------
      // PA-07 — sleep é proibido
      //
      // O discriminador é a ARIDADE do executor da Promise, e ele foi escolhido
      // olhando o código real: `apps/runner/src/quiescence.ts` usa
      // `new Promise((_, reject) => { timer = setTimeout(() => reject(...)) })`,
      // que é o padrão CORRETO prescrito pelo ADR-012 — deadline que falha, não
      // espera cega. O antipadrão é `new Promise(r => setTimeout(r, 3000))`:
      // executor de um parâmetro só, que resolve depois de um tempo fixo.
      //
      // LIMITE DECLARADO: um executor de dois parâmetros que resolva no timeout
      // escapa desta regra. É hipótese a calibrar; se aparecer na prática, o
      // caminho é `scripts/arch-check.mjs`, não afrouxar isto aqui.
      // ---------------------------------------------------------------------
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "NewExpression[callee.name='Promise'] > :matches(ArrowFunctionExpression, FunctionExpression)[params.length=1] CallExpression[callee.name='setTimeout']",
          message:
            "PA-07: espera por tempo fixo é proibida. Se você acredita que é inevitável, pare e abra uma issue — falta um sinal de progresso observável, e isso é informação valiosa sobre a aplicação. Use `converge()` com deadline e sinais de progresso.",
        },
        {
          selector: "CallExpression[callee.property.name='waitForTimeout']",
          message:
            "PA-07: `waitForTimeout` é espera cega. Use convergência com deadline e sinais de progresso observáveis.",
        },
        {
          selector: "CallExpression[callee.name=/^(sleep|delay)$/]",
          message:
            "PA-07: `sleep`/`delay` são proibidos no repositório inteiro, inclusive em teste (§7 do CLAUDE.md: aplicamos nossas próprias regras).",
        },
        // ---------------------------------------------------------------------
        // RN-CI-005 — erro de plataforma nunca bloqueia o PR do cliente
        //
        // Confundir falha de infraestrutura com falha de qualidade é um dos bugs
        // mais danosos possíveis neste produto: destrói a confiança do time do
        // cliente no gate. `throw new Error` genérico apaga a distinção logo na
        // origem, e nenhuma camada acima consegue recuperá-la.
        //
        // Hoje o repositório tem ZERO ocorrências — a regra entra para manter
        // assim, não para limpar dívida.
        // ---------------------------------------------------------------------
        {
          selector: "ThrowStatement > NewExpression[callee.name='Error']",
          message:
            "RN-CI-005: use `PlatformError` (não bloqueia o PR do cliente) ou `QualityVerdict` (pode bloquear), de @aletheia/shared. `Error` genérico apaga a distinção.",
        },
      ],

      // RN-EXE-002: toda linha de log carrega `runId`, `orgId`, `projectId`.
      // `console` não carrega nada disso e não é estruturado. Exceção para a
      // CLI, mais abaixo, que fala com uma pessoa e não com um coletor.
      "no-console": "error",

      // `any` desliga o compilador exatamente onde ele seria mais útil. O
      // CLAUDE.md §5 manda usar `unknown` + narrowing. Zero ocorrências hoje.
      "@typescript-eslint/no-explicit-any": "error",

      // Um `await` esquecido no runner corrompe convergência (ADR-012) e produz
      // medição inválida — o defeito não aparece como erro, aparece como número
      // errado, que é a pior forma.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",

      "import-x/no-cycle": ["error", { maxDepth: Infinity }],
      // Sem `packageDir`: a resolução é pelo package.json MAIS PRÓXIMO, que é o
      // que queremos. Cada pacote declara o que importa — inclusive `vitest`.
      // Hoje nada é publicado, mas a partir da Fase 1 há pacote publicável, e
      // dependência não declarada só quebra depois de publicada.
      "import-x/no-extraneous-dependencies": ["error", { devDependencies: true }],
      "import-x/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],

      // O repositório usa `verbatimModuleSyntax`; import de tipo precisa ser
      // explícito, senão o build quebra de formas difíceis de ler.
      //
      // `inline-type-imports` NÃO é preferência estética. Com o estilo padrão
      // (`import type` no topo), o auto-fix gerou `import type { A, type B }` —
      // sintaxe inválida — em três arquivos deste repositório, porque eles já
      // misturavam valor e tipo no mesmo import. O build quebrou. O estilo
      // inline é o que o código já usava e o único que o fixer acerta aqui.
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
    },
  },

  {
    // A CLI é a fronteira com a pessoa que rodou o comando: ali `stdout` é a
    // interface, não telemetria.
    files: ["shims/cli/**/*.ts"],
    rules: { "no-console": "off" },
  },

  {
    files: ["**/*.test.ts"],
    rules: {
      // Teste monta objeto parcial de propósito para exercitar um caminho; a
      // asserção não-nula ali é legível e não esconde nada.
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },

  {
    // Scripts e configs em `.mjs` não têm projeto TypeScript; lint com tipo não
    // se aplica. Continuam sujeitos às regras sintáticas acima.
    files: ["**/*.mjs", "**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: globals.node,
      parserOptions: { project: null },
    },
    rules: {
      "no-console": "off",
      "@typescript-eslint/consistent-type-imports": "off",
      // Plugins de ESLint exportam default E nomeados com o mesmo nome
      // (`tseslint.configs`, `importX.flatConfigs`). A regra avisa achando que
      // é engano; aqui é a API documentada dos plugins.
      "import-x/no-named-as-default": "off",
      "import-x/no-named-as-default-member": "off",
    },
  },

  // Por último: desliga tudo que conflita com o Prettier. Formatação não é
  // assunto do lint.
  prettier,
);
