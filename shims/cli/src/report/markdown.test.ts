import { readFileSync } from "node:fs";

import { parseCapture, runDiff, type Capture } from "@aletheia/diff-engine";
import type { RunMetadata } from "@aletheia/shared";
import { describe, expect, it } from "vitest";

import { PR_COMMENT_MARKER, renderPrComment } from "./markdown.js";

function loadFixture(name: string): Capture {
  const url = new URL(
    `../../../../packages/diff-engine/__fixtures__/checkout/${name}.json`,
    import.meta.url,
  );
  return parseCapture(JSON.parse(readFileSync(url, "utf8")), name);
}

const METADATA: RunMetadata = {
  runId: "run_test",
  worldModelVersion: null,
  irVersion: null,
  runnerVersion: "0.0.0-test",
  browserVersion: "chromium/1.0",
  seed: "0",
  commit: "bbbb222",
  baseRef: "main",
  environment: "test",
  confidenceMode: "SHARED_DEGRADED",
  dataStrategy: null,
  autonomyLevel: 1,
  startedAtUtc: "2026-01-10T12:10:00.000Z",
};

describe("comentário de PR", () => {
  const blocking = runDiff(loadFixture("base"), loadFixture("head-with-regressions"), {
    metadata: METADATA,
  });
  const clean = runDiff(loadFixture("base"), loadFixture("base-rerun"), { metadata: METADATA });

  it("abre com o marcador estável e o veredito, e diz que bloqueia", () => {
    const md = renderPrComment(blocking);
    expect(md.startsWith(PR_COMMENT_MARKER)).toBe(true);
    expect(md).toContain("REGRESSION_DETECTED — bloqueia");
    expect(md).toContain(blocking.verdict.rationale);
  });

  it("lista regressões por grupo, com contagem de deltas e páginas — não delta a delta", () => {
    const md = renderPrComment(blocking, { maxGroups: 100 });
    const groups = blocking.groups.filter((group) => group.classification === "REGRESSION");
    expect(md).toContain(
      `### Regressões — ${blocking.summary.byClassification.REGRESSION} delta(s) em ${groups.length} grupo(s)`,
    );
    for (const group of groups) {
      expect(md).toContain(`\`${group.kind}\``);
    }
    // Uma linha de tabela por grupo, não por delta.
    const rows = md
      .split("\n")
      .filter((line) => line.startsWith("| ") && /^\| (CRITICAL|HIGH|MEDIUM|LOW) \|/.test(line));
    expect(rows).toHaveLength(groups.length);
  });

  it("corta em maxGroups e diz quantos ficaram de fora", () => {
    const md = renderPrComment(blocking, { maxGroups: 2 });
    const groups = blocking.groups.filter((group) => group.classification === "REGRESSION").length;
    expect(md).toContain(`… e mais **${groups - 2} grupo(s)** de regressão`);
  });

  it("declara o que NÃO foi validado, sempre — mesmo sem regressão (PA-10)", () => {
    for (const md of [renderPrComment(blocking), renderPrComment(clean)]) {
      expect(md).toContain("### O que **não** foi validado");
      expect(md).toContain("**DATABASE**");
      expect(md).toContain("divergência zero não significa aplicação correta");
    }
  });

  it("declara o modo de confiança e o que ele custa em autonomia (RN-EXE-007)", () => {
    expect(renderPrComment(blocking)).toContain("**SHARED_DEGRADED** (ambientes compartilhados");
  });

  it("veredito limpo sai verde e sem seção de regressões", () => {
    const md = renderPrComment(clean);
    expect(md).toContain("🟢 NO_REGRESSION_DETECTED");
    expect(md).not.toContain("### Regressões");
  });

  it("escapa barras verticais e crases nas células — conteúdo do cliente não quebra a tabela", () => {
    const hostile = {
      ...blocking,
      deltas: blocking.deltas.map((delta) => ({ ...delta, before: "a | b `c`", after: null })),
    };
    const md = renderPrComment(hostile);
    expect(md).toContain("`a \\| b 'c'`");
  });

  it("carrega os metadados de execução (PA-12)", () => {
    const md = renderPrComment(blocking, { artifactsHint: "artefato `aletheia-run`" });
    expect(md).toContain("runId `run_test`");
    expect(md).toContain("commit `bbbb222`");
    expect(md).toContain("browser `chromium/1.0`");
    expect(md).toContain("artefatos completos: artefato `aletheia-run`");
  });
});
