import { PlatformError } from "@aletheia/shared";
import { describe, expect, it } from "vitest";

import { DEFAULT_CONSENSUS, decide, type SignalMatches } from "./consensus.js";
import { GENERATED_ID_WEIGHT, isGeneratedId, weightedSignalsOf } from "./fingerprint.js";
import { proposeHeal } from "./heal.js";
import { parseElementRepository } from "./repository.js";

const m = (
  signal: SignalMatches["signal"],
  weight: number,
  ...candidateKeys: string[]
): SignalMatches => ({ signal, weight, candidateKeys });

describe("detector de id gerado", () => {
  it("reconhece o que muda de build para build", () => {
    for (const value of [
      "mui-4821",
      ":r1a:",
      "css-1x2y3z",
      "sc-bdVaJa",
      "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      "btn-a3f9c2e1",
      "item-12345",
      "chakra-button",
    ]) {
      expect(isGeneratedId(value), value).toBe(true);
    }
  });

  it("não reconhece identidade escrita por gente", () => {
    for (const value of [
      "checkout-submit",
      "btn-entrar",
      "campo-nome",
      "nav-primary",
      "id_q",
      "state",
    ]) {
      expect(isGeneratedId(value), value).toBe(false);
    }
  });

  it("rebaixa testId e css com cara de gerado, mantendo os outros pesos", () => {
    const signals = weightedSignalsOf({ testId: "mui-4821", css: "#css-1x2y3z", text: "Entrar" });
    expect(signals.map((s) => [s.signal, s.weight])).toEqual([
      ["testId", GENERATED_ID_WEIGHT],
      ["text", 0.7],
      ["css", GENERATED_ID_WEIGHT],
    ]);
    expect(signals[0]?.note).toContain("rebaixado");
  });
});

describe("consenso", () => {
  it("unanimidade: um candidato, todos os sinais, confiança 1.0", () => {
    const verdict = decide([m("testId", 1, "A"), m("role+name", 0.9, "A"), m("text", 0.7, "A")]);
    expect(verdict.kind).toBe("RESOLVED");
    if (verdict.kind !== "RESOLVED") return;
    expect(verdict.key).toBe("A");
    expect(verdict.confidence).toBe(1);
    expect(verdict.healed).toBe(false);
    expect(verdict.failedSignals).toEqual([]);
  });

  it("sinais discordam: o peso decide, e o trace diz quem perdeu", () => {
    // testId aponta A; role+name e text apontam B. B soma 1.6 > A 1.0.
    const verdict = decide([m("testId", 1, "A"), m("role+name", 0.9, "B"), m("text", 0.7, "B")]);
    expect(verdict.kind).toBe("RESOLVED");
    if (verdict.kind !== "RESOLVED") return;
    expect(verdict.key).toBe("B");
    expect(verdict.failedSignals).toEqual(["testId"]);
    // testId (peso 1.0 ≥ 0.7) falhou no vencedor: fingerprint desatualizado.
    expect(verdict.healed).toBe(true);
    expect(verdict.confidence).toBeCloseTo(1.6 / 2.6, 3);
  });

  it("sinal fraco que falha não é cura", () => {
    const verdict = decide([m("testId", 1, "A"), m("css", 0.15)]);
    expect(verdict.kind === "RESOLVED" && verdict.healed).toBe(false);
  });

  it("um sinal promíscuo sozinho não resolve: fica abaixo do mínimo", () => {
    const verdict = decide([m("text", 0.7, "A", "B", "C"), m("css", 0.15)]);
    expect(verdict.kind).toBe("AMBIGUOUS");
    if (verdict.kind === "AMBIGUOUS") expect(verdict.reason).toContain("empate");
  });

  it("empate no topo é ambíguo, e nth desempata na ordem do documento do sinal mais forte", () => {
    const matches = [m("text", 0.7, "A", "B"), m("role+name", 0.9, "A", "B")];
    expect(decide(matches).kind).toBe("AMBIGUOUS");
    const second = decide(matches, { ...DEFAULT_CONSENSUS, nth: 1 });
    expect(second.kind === "RESOLVED" && second.key).toBe("B");
    const beyond = decide(matches, { ...DEFAULT_CONSENSUS, nth: 5 });
    expect(beyond.kind === "AMBIGUOUS" && beyond.reason).toContain("fora do alcance");
  });

  it("cura sem corroboração é ambiguidade: um sinal secundário sozinho não cura", () => {
    // testId e role+name falharam; só o texto casou um elemento (talvez um h1).
    const verdict = decide([m("testId", 1), m("role+name", 0.9), m("text", 0.7, "H1")]);
    expect(verdict.kind).toBe("AMBIGUOUS");
    if (verdict.kind === "AMBIGUOUS") expect(verdict.reason).toContain("cura sem corroboração");
    // Com o sinal mais forte casando sozinho, cura: alguém marcou aquele elemento.
    const byStrongest = decide([m("testId", 1, "B"), m("role+name", 0.9), m("text", 0.7)]);
    expect(byStrongest.kind === "RESOLVED" && byStrongest.healed).toBe(true);
    // Dois sinais secundários concordando corroboram.
    const byTwo = decide([m("testId", 1), m("role+name", 0.9, "B"), m("text", 0.7, "B")]);
    expect(byTwo.kind === "RESOLVED" && byTwo.healed).toBe(true);
  });

  it("um único sinal declarado casando um único elemento resolve, mesmo abaixo do mínimo", () => {
    const alone = decide([m("field", 0.5, "A")]);
    expect(alone.kind === "RESOLVED" && alone.confidence).toBe(1);
    // Com outro sinal declarado que falhou, o mesmo 0.5 é fraco demais.
    const amid = decide([m("label", 0.8), m("field", 0.5, "A")]);
    expect(amid.kind).toBe("AMBIGUOUS");
  });

  it("nada casou: NOT_FOUND com os sinais tentados", () => {
    const verdict = decide([m("testId", 1), m("label", 0.8)]);
    expect(verdict).toEqual({ kind: "NOT_FOUND", triedSignals: ["testId", "label"] });
  });

  it("é determinístico: mesma entrada em outra ordem, mesma decisão", () => {
    const a = decide([m("testId", 1, "A"), m("text", 0.7, "B", "A")]);
    const b = decide([m("text", 0.7, "A", "B"), m("testId", 1, "A")]);
    expect(a.kind === "RESOLVED" && b.kind === "RESOLVED" && a.key === b.key).toBe(true);
  });
});

describe("proposta de cura", () => {
  it("troca só o que falhou pelo observado, mantém o resto, e nasce PROPOSED", () => {
    const consensus = decide([m("testId", 1, "A"), m("role+name", 0.9, "B"), m("text", 0.7, "B")]);
    if (consensus.kind !== "RESOLVED")
      throw new PlatformError("INTERNAL_INVARIANT_BROKEN", { reason: "esperava RESOLVED" });
    const heal = proposeHeal({
      stepId: "st_4",
      elementRef: "el_btn_entrar",
      declared: { testId: "btn-entrar", role: "button", name: "Entrar", text: "Entrar" },
      observed: { testId: "btn-acessar" },
      consensus,
      screenshotPath: "healing/st_4.png",
      nowUtc: "2026-08-17T00:00:00.000Z",
    });
    expect(heal.status).toBe("PROPOSED");
    expect(heal.staleSignals).toEqual(["testId"]);
    expect(heal.proposal).toEqual({
      testId: "btn-acessar",
      role: "button",
      name: "Entrar",
      text: "Entrar",
    });
    expect(heal.declared.testId).toBe("btn-entrar");
  });

  it("sinal falho sem valor observado sai da proposta em vez de ficar errado", () => {
    const consensus = decide([m("testId", 1, "A"), m("label", 0.8, "B"), m("text", 0.7, "B")]);
    if (consensus.kind !== "RESOLVED")
      throw new PlatformError("INTERNAL_INVARIANT_BROKEN", { reason: "esperava RESOLVED" });
    const heal = proposeHeal({
      stepId: "s",
      elementRef: null,
      declared: { testId: "x", label: "Nome", text: "Nome" },
      observed: {},
      consensus,
      screenshotPath: null,
      nowUtc: "2026-08-17T00:00:00.000Z",
    });
    expect(heal.proposal).toEqual({ label: "Nome", text: "Nome" });
  });
});

describe("repositório de elementos", () => {
  it("lê, exige id el_ e recusa duplicado", () => {
    const repo = parseElementRepository(
      {
        version: "0.1.0",
        projectId: "fixture",
        elements: [
          {
            id: "el_btn_entrar",
            description: "botão de login",
            fingerprint: { role: "button", name: "Entrar" },
          },
        ],
      },
      "t",
    );
    expect(repo.elements[0]?.stability).toEqual({
      resolvedRuns: 0,
      healedRuns: 0,
      lastHealAtUtc: null,
    });
    expect(() =>
      parseElementRepository(
        { version: "0.1.0", projectId: "x", elements: [{ id: "botao", fingerprint: {} }] },
        "t",
      ),
    ).toThrow();
  });
});
