import { PlatformError } from "@aletheia/shared";
import { describe, expect, it } from "vitest";

import { irToJourney, journeyToIr, loadJourney } from "./migrate.js";
import { IR_VERSION, type IrJourney } from "./schema.js";
import { parseIr } from "./validate.js";

const legacy = {
  journeyVersion: "0.1.0",
  name: "juventude-smoke",
  viewport: { width: 1280, height: 800 },
  observations: [
    { observationId: "home", path: "/" },
    { observationId: "contato", path: "/contato", masks: [{ x: 0, y: 0, width: 10, height: 10 }] },
  ],
};

const login: IrJourney = {
  irVersion: IR_VERSION,
  id: "jr_login",
  name: "login",
  viewport: { width: 1280, height: 800 },
  steps: [
    { id: "st_1", action: "navigate", path: "/entrar" },
    { id: "st_2", action: "fill", target: { label: "E-mail" }, value: "qa@exemplo.com" },
    { id: "st_3", action: "fill", target: { label: "Senha" }, value: { secretRef: "QA_SENHA" } },
    { id: "st_4", action: "click", target: { role: "button", name: "Entrar" } },
    { id: "st_5", action: "observe", observationId: "painel", masks: [] },
  ],
};

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof PlatformError)
      return `${error.code}:${String(error.context["path"] ?? "")}`;
    throw error;
  }
  return "ok";
};

describe("parseIr", () => {
  it("aceita uma jornada com ações e devolve o mesmo conteúdo", () => {
    expect(parseIr(JSON.parse(JSON.stringify(login)), "t")).toEqual(login);
  });

  it("recusa versão desconhecida com o código próprio", () => {
    expect(code(() => parseIr({ ...login, irVersion: "2.0.0" }, "t"))).toBe(
      "IR_VERSION_UNSUPPORTED:",
    );
  });

  it("recusa ação antes de navegar — não há página", () => {
    const ir = { ...login, steps: [login.steps[1], login.steps[0], login.steps[4]] };
    expect(code(() => parseIr(ir, "t"))).toBe("IR_INVALID:$.steps[0]");
  });

  it("recusa jornada sem observe — não produz evidência", () => {
    const ir = { ...login, steps: login.steps.slice(0, 4) };
    expect(code(() => parseIr(ir, "t"))).toBe("IR_INVALID:$.steps");
  });

  it("recusa alvo só com css — seletor único (§3.5)", () => {
    const ir = {
      ...login,
      steps: [
        login.steps[0],
        { id: "x", action: "click", target: { css: "#btn" } },
        login.steps[4],
      ],
    };
    expect(code(() => parseIr(ir, "t"))).toBe("IR_INVALID:$.steps[1].target");
  });

  it("aceita css como complemento de sinal semântico", () => {
    const ir = {
      ...login,
      steps: [
        login.steps[0],
        { id: "x", action: "click", target: { text: "Entrar", css: "form button" } },
        login.steps[4],
      ],
    };
    expect(code(() => parseIr(ir, "t"))).toBe("ok");
  });

  it("role e name andam juntos", () => {
    const only = (target: Record<string, string>) => ({
      ...login,
      steps: [login.steps[0], { id: "x", action: "click", target }, login.steps[4]],
    });
    expect(code(() => parseIr(only({ role: "button" }), "t"))).toBe(
      "IR_INVALID:$.steps[1].target.role",
    );
    expect(code(() => parseIr(only({ name: "Entrar" }), "t"))).toBe(
      "IR_INVALID:$.steps[1].target.name",
    );
  });

  it("recusa ids duplicados de passo e de observação", () => {
    const dupStep = { ...login, steps: [login.steps[0], { ...login.steps[4], id: "st_1" }] };
    expect(code(() => parseIr(dupStep, "t"))).toBe("IR_INVALID:$.steps[1].id");
    const dupObs = { ...login, steps: [...login.steps, { ...login.steps[4], id: "st_6" }] };
    expect(code(() => parseIr(dupObs, "t"))).toBe("IR_INVALID:$.steps[5].observationId");
  });

  it("segredo é referência a variável de ambiente, nunca valor", () => {
    const ir = {
      ...login,
      steps: [
        login.steps[0],
        { id: "x", action: "fill", target: { label: "Senha" }, value: { secretRef: "minusculo" } },
        login.steps[4],
      ],
    };
    expect(code(() => parseIr(ir, "t"))).toBe("IR_INVALID:$.steps[1].value");
  });
});

describe("migração 0.1.0 ⇄ 1.0.0", () => {
  it("sobe: cada rota vira navigate + observe, máscaras preservadas", () => {
    const { ir, migrated } = loadJourney(legacy, "t");
    expect(migrated).toBe(true);
    expect(ir.id).toBe("jr_juventude-smoke");
    expect(ir.steps.map((step) => step.action)).toEqual([
      "navigate",
      "observe",
      "navigate",
      "observe",
    ]);
    const observe = ir.steps[3];
    expect(observe?.action === "observe" && observe.masks).toEqual([
      { x: 0, y: 0, width: 10, height: 10 },
    ]);
    // O que subiu passa no validador da versão nova.
    expect(parseIr(JSON.parse(JSON.stringify(ir)), "t")).toEqual(ir);
  });

  it("desce o que cabe: navigate + observe volta a ser lista de rotas, e o ciclo é identidade", () => {
    const { ir } = loadJourney(legacy, "t");
    const back = irToJourney(ir);
    expect(back).toEqual({
      ...legacy,
      observations: [
        { observationId: "home", path: "/", masks: [] },
        {
          observationId: "contato",
          path: "/contato",
          masks: [{ x: 0, y: 0, width: 10, height: 10 }],
        },
      ],
    });
    expect(journeyToIr(back)).toEqual(ir);
  });

  it("descer uma IR com ação é recusado, nomeando o passo — nunca descartado em silêncio", () => {
    expect(code(() => irToJourney(login))).toBe("IR_INVALID:st_2");
  });

  it("loadJourney lê IR v1 sem migrar", () => {
    const { ir, migrated } = loadJourney(JSON.parse(JSON.stringify(login)), "t");
    expect(migrated).toBe(false);
    expect(ir).toEqual(login);
  });
});
