#!/usr/bin/env node
/**
 * Aplica a proteção de branch descrita em CLAUDE.md §11 — `pnpm protect`.
 *
 * NÃO FOI POSSÍVEL APLICAR EM 2026-08-13, e o motivo é de plano, não de
 * configuração: `cleberAraujo01/ALETHEIA` é privado, e o GitHub cobra proteção
 * de branch (clássica e rulesets) em repositório privado. As duas chamadas
 * devolvem 403 "Upgrade to GitHub Pro or make this repository public".
 *
 * Três saídas, e a escolha é do dono do repositório:
 *   1. tornar o repositório público — libera as duas APIs, custo zero;
 *   2. assinar o GitHub Pro;
 *   3. seguir sem proteção, apoiado no CI e na disciplina do CONTRIBUTING.
 *
 * A terceira é a que está valendo hoje, e ela tem um buraco declarado: nada
 * impede `git push` direto na `main`. O CI ainda roda e ainda reprova, mas
 * depois do fato.
 *
 * Quando uma das duas primeiras acontecer, rode este script uma vez.
 *
 * A EXIGÊNCIA DE APROVAÇÃO NASCE EM 0 DE PROPÓSITO: o repositório tem um
 * contribuidor, e o GitHub não deixa ninguém aprovar o próprio PR. Com 1, todo
 * merge trava. Suba para 1 quando entrar a segunda pessoa — e para 2 nas áreas
 * marcadas no CODEOWNERS.
 */
import { spawnSync } from "node:child_process";

const REPO = process.env["ALETHEIA_REPO"] ?? "cleberAraujo01/ALETHEIA";

const ruleset = {
  name: "main e fase — PR obrigatorio",
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["refs/heads/main", "refs/heads/fase/*"], exclude: [] } },
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" },
    {
      type: "pull_request",
      parameters: {
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: true,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: true,
        automatic_copilot_code_review_enabled: false,
        allowed_merge_methods: ["squash", "merge"],
      },
    },
    // Os nomes têm de bater com os `name:` dos jobs em .github/workflows/ci.yml.
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: [{ context: "verificacao" }],
      },
    },
  ],
};

const result = spawnSync("gh", ["api", "-X", "POST", `repos/${REPO}/rulesets`, "--input", "-"], {
  input: JSON.stringify(ruleset),
  encoding: "utf8",
  shell: process.platform === "win32",
});

process.stdout.write(result.stdout ?? "");
if (result.status !== 0) {
  process.stderr.write(result.stderr ?? "");
  process.stderr.write(
    "\n  Falhou. Se a mensagem for 'Upgrade to GitHub Pro or make this repository\n" +
      "  public', o repositório continua privado no plano free e a proteção não está\n" +
      "  disponível — ver o cabeçalho deste arquivo.\n\n",
  );
  process.exit(1);
}
process.stdout.write("\n  proteção aplicada em main e fase/*\n\n");
