import { describe, expect, it } from "vitest";

import type { ConsoleEntry } from "../types/capture.js";

import { diffConsole } from "./console.js";
import { DeltaBudget, type RawDelta } from "./types.js";

const entrada = (level: ConsoleEntry["level"], text: string): ConsoleEntry => ({ level, text });

const diff = (base: ConsoleEntry[], head: ConsoleEntry[]): RawDelta[] =>
  diffConsole("obs", base, head, new DeltaBudget(200));

describe("diff de console", () => {
  it("erro novo no head é o sinal que motivou a camada", () => {
    // Caso real do corpus `juventude`: a rota do menu com erro de digitação faz
    // o prefetch receber 404, e o browser registra em TODAS as sete páginas.
    const erro = entrada(
      "error",
      "Failed to load resource: the server responded with a status of 404 (Not Found)",
    );
    const [delta] = diff([], [erro]);

    expect(delta?.kind).toBe("CONSOLE_MESSAGE_ADDED");
    expect(delta?.facts["level"]).toBe("error");
  });

  it("console idêntico não produz delta — é o piso de ruído desta camada", () => {
    const mesmas = [entrada("warn", "aviso de framework"), entrada("log", "pronto")];
    expect(diff(mesmas, [...mesmas])).toHaveLength(0);
  });

  it("mensagem que some é reportada, não escondida", () => {
    const [delta] = diff([entrada("error", "quebrou")], []);
    expect(delta?.kind).toBe("CONSOLE_MESSAGE_REMOVED");
  });

  it("a mesma mensagem repetindo mais vezes vira um delta de contagem", () => {
    // Conjunto perderia isto: 1 → 40 é laço ou retry em cascata, e o texto é o
    // mesmo nos dois lados.
    const um = [entrada("error", "falhou")];
    const quarenta = Array.from({ length: 40 }, () => entrada("error", "falhou"));
    const [delta] = diff(um, quarenta);

    expect(delta?.kind).toBe("CONSOLE_COUNT_CHANGED");
    expect(delta?.facts["baseCount"]).toBe(1);
    expect(delta?.facts["headCount"]).toBe(40);
  });

  it("espaço em branco não cria diferença", () => {
    expect(diff([entrada("log", "a   b")], [entrada("log", " a b ")])).toHaveLength(0);
  });

  it("nível diferente com mesmo texto são mensagens diferentes", () => {
    // `warn` virando `error` é escalada de severidade da própria aplicação, e
    // colapsar os dois esconderia isso.
    const deltas = diff([entrada("warn", "x")], [entrada("error", "x")]);
    expect(deltas.map((d) => d.kind).sort()).toEqual([
      "CONSOLE_MESSAGE_ADDED",
      "CONSOLE_MESSAGE_REMOVED",
    ]);
  });
});
