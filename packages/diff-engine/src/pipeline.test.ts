import { readFileSync } from "node:fs";

import { PlatformError, type RunMetadata } from "@aletheia/shared";
import { describe, expect, it } from "vitest";

import { parseCapture } from "./capture/validate.js";
import { runDiff } from "./pipeline.js";
import type { Capture } from "./types/capture.js";
import type { Delta, DeltaKind } from "./types/delta.js";

function loadFixture(name: string): Capture {
  const url = new URL(`../__fixtures__/checkout/${name}.json`, import.meta.url);
  return parseCapture(JSON.parse(readFileSync(url, "utf8")), name);
}

const METADATA: RunMetadata = {
  runId: "run_test",
  worldModelVersion: null,
  irVersion: null,
  runnerVersion: "0.0.0-test",
  browserVersion: null,
  seed: "0",
  commit: "bbbb222",
  baseRef: "main",
  environment: "test",
  confidenceMode: "ISOLATED",
  dataStrategy: null,
  autonomyLevel: 1,
  startedAtUtc: "2026-01-10T12:10:00.000Z",
};

const find = (deltas: readonly Delta[], kind: DeltaKind, pathPart: string): Delta | undefined =>
  deltas.find((delta) => delta.kind === kind && delta.path.includes(pathPart));

describe("corpus checkout — head com regressões conhecidas", () => {
  const report = runDiff(loadFixture("base"), loadFixture("head-with-regressions"), {
    metadata: METADATA,
  });

  it("emite veredito bloqueante fundamentado no oráculo O5", () => {
    expect(report.verdict.code).toBe("REGRESSION_DETECTED");
    expect(report.verdict.blocking).toBe(true);
    // RN-ORC-001: veredito sem oráculo identificado é inválido.
    expect(report.oracle).toBe("O5");
  });

  it("detecta ao menos 5 regressões — o critério de saída da Fase 0", () => {
    expect(report.summary.byClassification.REGRESSION).toBeGreaterThanOrEqual(5);
  });

  it("detecta a resposta que passou a falhar", () => {
    const delta = find(report.deltas, "STATUS_CHANGED", "POST /api/checkout");
    expect(delta?.severity).toBe("CRITICAL");
    expect(delta?.before).toBe("200");
    expect(delta?.after).toBe("500");
  });

  it("detecta o desconto que mudou de 15 para 10 sem intenção declarada", () => {
    // O caso central do problema do oráculo: a tela renderiza, a API devolve
    // 200 e o cálculo está errado.
    const delta = find(report.deltas, "RESPONSE_FIELD_CHANGED", "/discountPct");
    expect(delta?.before).toBe("15");
    expect(delta?.after).toBe("10");
    expect(delta?.classification).toBe("REGRESSION");
  });

  it("detecta o campo de contrato que desapareceu", () => {
    const delta = find(report.deltas, "RESPONSE_FIELD_REMOVED", "/freight");
    expect(delta?.severity).toBe("HIGH");
    expect(delta?.classification).toBe("REGRESSION");
  });

  it("detecta o N+1 que surgiu", () => {
    const delta = find(report.deltas, "REQUEST_COUNT_CHANGED", "/api/products/:id");
    expect(delta?.before).toBe("1");
    expect(delta?.after).toBe("6");
    expect(delta?.facts["amplification"]).toBe(6);
    expect(delta?.classification).toBe("REGRESSION");
  });

  it("detecta o botão interativo que sumiu", () => {
    const delta = find(report.deltas, "DOM_NODE_REMOVED", "apply-coupon");
    expect(delta?.severity).toBe("HIGH");
    expect(delta?.classification).toBe("REGRESSION");
  });

  it("detecta o botão que passou a nascer desabilitado", () => {
    const delta = find(report.deltas, "DOM_ATTRIBUTE_ADDED", 'checkout"]@disabled');
    expect(delta?.severity).toBe("HIGH");
    expect(delta?.classification).toBe("REGRESSION");
  });

  it("reporta mudança de texto como indeterminada, não como regressão", () => {
    // Texto muda por copy legítimo com frequência alta demais para bloquear um
    // PR sem fonte de intenção. UNDETERMINED nunca bloqueia (RN-ORC-009).
    const delta = find(report.deltas, "DOM_TEXT_CHANGED", "discount");
    expect(delta?.classification).toBe("UNDETERMINED");
  });

  it("não classifica nada como INTENDED_CHANGE nesta fase", () => {
    // Não existe fonte de intenção (O1/O2/O3). Afirmar intenção seria inventar.
    expect(report.summary.byClassification.INTENDED_CHANGE).toBe(0);
  });

  it("declara o que não foi validado", () => {
    const layers = report.coverage.layersNotValidated.map((gap) => gap.layer);
    expect(layers).toContain("VISUAL");
    expect(layers).toContain("DATABASE");
    expect(report.coverage.notes.join(" ")).toContain("não detecta defeito já presente");
  });
});

describe("corpus checkout — mesma build reexecutada (teste de falso positivo)", () => {
  const report = runDiff(loadFixture("base"), loadFixture("base-rerun"), { metadata: METADATA });

  it("não produz nenhum delta", () => {
    // Se este teste falhar, o motor está reportando ruído como divergência e a
    // taxa de falso positivo do produto inteiro sobe junto.
    expect(report.deltas.map((delta) => `${delta.kind} ${delta.path}`)).toEqual([]);
  });

  it("emite veredito não bloqueante", () => {
    expect(report.verdict.code).toBe("NO_REGRESSION_DETECTED");
    expect(report.verdict.blocking).toBe(false);
  });

  it("registra as normalizações que aplicou em vez de escondê-las", () => {
    expect(report.normalization.total).toBeGreaterThan(0);
    expect(Object.keys(report.normalization.byRule).length).toBeGreaterThan(0);
  });
});

describe("par preview × produção na Vercel — medido no PR #2 do piloto juventude", () => {
  const loadVercel = (name: string): Capture => {
    const url = new URL(`../__fixtures__/vercel-next/${name}.json`, import.meta.url);
    return parseCapture(JSON.parse(readFileSync(url, "utf8")), name);
  };

  it("buildId do Next.js e toolbar de preview não produzem delta nenhum", () => {
    // No par real, um PR que só tocava README rendeu 45 deltas: 38 eram o
    // buildId (novo a cada deploy, mesmo com código idêntico) e 7 eram o
    // feedback.js que a Vercel injeta SÓ em preview.
    const report = runDiff(loadVercel("base"), loadVercel("head"), { metadata: METADATA });
    expect(report.deltas.map((delta) => `${delta.kind} ${delta.path}`)).toEqual([]);
    expect(report.verdict.code).toBe("NO_REGRESSION_DETECTED");
  });

  it("registra as duas regras no ledger — nada some em silêncio", () => {
    const report = runDiff(loadVercel("base"), loadVercel("head"), { metadata: METADATA });
    // 2 ocorrências por documento (comentário + flight) × 2 lados, mais 1 por
    // resposta RSC de cada lado = 6; e 1 requisição de toolbar removida.
    expect(report.normalization.byRule["NORM-NET-011"]).toBe(6);
    expect(report.normalization.byRule["NORM-NET-012"]).toBe(1);
  });

  it("mudança REAL no corpo continua visível — a máscara é o token, não o corpo", () => {
    const report = runDiff(loadVercel("base"), loadVercel("head-com-regressao"), {
      metadata: METADATA,
    });
    const kinds = report.deltas.map((delta) => delta.kind);
    // O texto que mudou dentro do documento segue detectado…
    expect(kinds).toContain("RESPONSE_FIELD_CHANGED");
    const changed = report.deltas.find((delta) => delta.kind === "RESPONSE_FIELD_CHANGED");
    expect(changed?.before).toContain("Bem-vindo");
    expect(changed?.after).toContain("Bem viiindo");
    // …e o analytics de terceiro que sumiu também: o filtro é SÓ para o host
    // da plataforma de deploy, não para terceiro qualquer.
    expect(kinds).toContain("REQUEST_REMOVED");
  });
});

describe("determinismo (PA-12)", () => {
  it("produz o mesmo relatório para a mesma entrada", () => {
    const first = runDiff(loadFixture("base"), loadFixture("head-with-regressions"), {
      metadata: METADATA,
    });
    const second = runDiff(loadFixture("base"), loadFixture("head-with-regressions"), {
      metadata: METADATA,
    });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe("distinção entre falha de plataforma e veredito de qualidade (RN-CI-005)", () => {
  it("captura ilegível vira PlatformError, nunca reprovação do cliente", () => {
    expect(() => parseCapture({ captureVersion: "0.1.0" }, "teste")).toThrow(PlatformError);
  });

  it("versão de captura não suportada vira PlatformError", () => {
    try {
      parseCapture({ captureVersion: "99.0.0" }, "teste");
      expect.unreachable("deveria ter lançado");
    } catch (error) {
      expect(error).toBeInstanceOf(PlatformError);
      expect((error as PlatformError).code).toBe("CAPTURE_VERSION_UNSUPPORTED");
    }
  });

  it("capturas sem observação em comum viram PlatformError, não veredito", () => {
    const base = loadFixture("base");
    const foreign: Capture = {
      ...base,
      observations: base.observations.map((observation) => ({
        ...observation,
        observationId: "outra.jornada",
      })),
    };
    try {
      runDiff(base, foreign, { metadata: METADATA });
      expect.unreachable("deveria ter lançado");
    } catch (error) {
      expect(error).toBeInstanceOf(PlatformError);
      expect((error as PlatformError).code).toBe("CAPTURES_NOT_COMPARABLE");
    }
  });
});

describe("jornada interrompida — a captura diz, o relatório declara", () => {
  const base = loadFixture("base");
  const head = loadFixture("head-with-regressions");

  it("head interrompido: observação que faltou aparece só na base e a cobertura explica por quê", () => {
    const interruptedHead = {
      ...head,
      observations: [],
      interruption: {
        stepId: "st_2",
        action: "click",
        reason: "alvo não encontrado (sinais tentados: role+name)",
        missingObservationIds: ["checkout.summary"],
      },
    };
    // Sem observação em comum não há diff — e isso é falha de plataforma, não
    // veredito. O caso testado abaixo mantém uma observação em comum.
    expect(() => runDiff(base, interruptedHead, { metadata: METADATA })).toThrow(PlatformError);

    const partialHead = {
      ...head,
      interruption: {
        stepId: "st_9",
        action: "click",
        reason: "alvo não encontrado (sinais tentados: role+name)",
        missingObservationIds: ["pagamento"],
      },
    };
    const partialBase = {
      ...base,
      observations: [
        ...base.observations,
        { ...base.observations[0]!, observationId: "pagamento" },
      ],
    };
    const report = runDiff(partialBase, partialHead, { metadata: METADATA });
    expect(report.coverage.observationsOnlyInBase).toEqual(["pagamento"]);
    const note = report.coverage.notes.find((entry) => entry.includes("INTERROMPIDA"));
    expect(note).toContain("captura head no passo st_9 (click)");
    expect(note).toContain("Observações não produzidas: pagamento");
    expect(note).toContain("A base chegou até o fim");
    // E o veredito continua vindo dos deltas: observação só na base é HIGH.
    expect(report.deltas.some((delta) => delta.kind === "OBSERVATION_REMOVED")).toBe(true);
  });

  it("captura de versão antiga sem o campo é lida como não interrompida", () => {
    expect(base.interruption).toBeNull();
  });
});
