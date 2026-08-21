import { describe, expect, it } from "vitest";

import { parseCaptureArgs, parseRunArgs } from "./args.js";

/**
 * `--secret-header` carrega o NOME de uma variável de ambiente, nunca o valor
 * (PA-09: argv aparece em log de CI). O parser aceita só a forma estreita
 * declarada e recusa o resto com o motivo.
 */
describe("--secret-header", () => {
  const base = ["--base-url", "http://b", "--head-url", "http://h", "--journey", "j.json"];

  it("ausente é lista vazia", () => {
    expect(parseRunArgs(base).secretHeaders).toEqual([]);
  });

  it("um header, e vários separados por vírgula", () => {
    expect(
      parseRunArgs([...base, "--secret-header", "x-vercel-protection-bypass=VERCEL_BYPASS"])
        .secretHeaders,
    ).toEqual([{ header: "x-vercel-protection-bypass", envVar: "VERCEL_BYPASS" }]);
    expect(
      parseCaptureArgs([
        "--url",
        "http://b",
        "--journey",
        "j.json",
        "--secret-header",
        "x-a=VAR_A,x-b=VAR_B",
      ]).secretHeaders,
    ).toEqual([
      { header: "x-a", envVar: "VAR_A" },
      { header: "x-b", envVar: "VAR_B" },
    ]);
  });

  for (const invalid of [
    "sem-igual",
    "=SO_VARIAVEL",
    "so-header=",
    "com espaço=VAR",
    "x-ok=1COMECA_COM_DIGITO",
  ]) {
    it(`recusa a forma inválida: ${invalid}`, () => {
      expect(() => parseRunArgs([...base, "--secret-header", invalid])).toThrowError(
        expect.objectContaining({ code: "CAPTURE_INVALID" }) as Error,
      );
    });
  }
});
