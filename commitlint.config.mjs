/**
 * Conventional Commits.
 *
 * O ganho concreto aqui não é estética de histórico: é que o escopo do commit
 * responde "que pacote isto pode ter quebrado?" sem abrir o diff. Num
 * repositório onde uma mudança no `diff-engine` obriga a reportar precisão e
 * recall (CLAUDE.md §6.4), saber isso pelo assunto do commit é o que torna a
 * regra verificável em vez de decorativa.
 *
 * ESCOPOS = pacotes que existem. A lista é curta de propósito e cresce quando
 * um pacote nasce; escopo livre viraria taxonomia paralela sem dono.
 */

/** @type {import("@commitlint/types").UserConfig} */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      [
        "diff-engine",
        "shared",
        "runner",
        "cli",
        "corpus",
        "docs",
        "infra",
        "deps",
        // Mudança que atravessa tudo e não tem dono único. Use com parcimônia:
        // se cabe num pacote, o escopo é o pacote.
        "repo",
      ],
    ],
    // O corpo explica POR QUE. Assunto sozinho não sustenta a revisão que este
    // repositório exige, e os commits existentes já seguem esse padrão.
    "body-max-line-length": [1, "always", 100],
    "subject-case": [0],
  },
};
