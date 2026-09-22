import { describe, expect, it } from "vitest";

import { parseInitArgs } from "./args.js";
import { journeyFromRoutes, observationIdOf, projectNameOf, workflowYaml } from "./init.js";

describe("aletheia init — jornada a partir de rotas", () => {
  it("observationId é slug do caminho; home é `home`; colisão ganha sufixo", () => {
    expect(observationIdOf("/")).toBe("home");
    expect(observationIdOf("/quem-somos")).toBe("quem-somos");
    expect(observationIdOf("/loja/produto/Camisa Azul")).toBe("loja-produto-camisa-azul");
    const journey = journeyFromRoutes("loja", ["/", "/a-b", "/a/b"]);
    const ids = journey.steps.flatMap((s) => (s.action === "observe" ? [s.observationId] : []));
    expect(ids).toEqual(["home", "a-b", "a-b-2"]);
  });

  it("gera IR v1 válida: navigate + observe por rota, ids sequenciais, viewport fixo", () => {
    const journey = journeyFromRoutes("loja", ["/", "/contato/"]);
    expect(journey.irVersion).toBe("1.0.0");
    expect(journey.id).toBe("jr_loja");
    expect(journey.steps.map((s) => `${s.id}:${s.action}`)).toEqual([
      "st_01:navigate",
      "st_02:observe",
      "st_03:navigate",
      "st_04:observe",
    ]);
    expect(journey.steps[2]).toMatchObject({ action: "navigate", path: "/contato" });
  });

  it("nome do projeto vem do host, sem www", () => {
    expect(projectNameOf("https://www.loja.com.br/x")).toBe("loja-com-br");
    expect(projectNameOf("http://127.0.0.1:3000")).toBe("127-0-0-1");
  });
});

describe("aletheia init — workflow", () => {
  const base = {
    baseUrl: "https://loja.exemplo",
    journeyPath: ".aletheia/jornada.json",
    aletheiaRef: "piloto-3",
  };

  it("é o workflow do piloto, parametrizado; sem header secreto não há bloco env", () => {
    const yaml = workflowYaml({ ...base, secretHeader: null });
    expect(yaml).toContain("on:\n  deployment_status:");
    expect(yaml).toContain("uses: cleberAraujo01/ALETHEIA/shims/github-action@piloto-3");
    expect(yaml).toContain("aletheia-ref: piloto-3");
    expect(yaml).toContain("base-url: https://loja.exemplo");
    expect(yaml).toContain("journey: .aletheia/jornada.json");
    expect(yaml).not.toContain("secret-header");
    expect(yaml).not.toContain("env:");
  });

  it("header secreto entra pelo NOME da variável, via secrets do repositório — nunca o valor", () => {
    const yaml = workflowYaml({
      ...base,
      secretHeader: "x-vercel-protection-bypass=VERCEL_AUTOMATION_BYPASS_SECRET",
    });
    expect(yaml).toContain(
      "secret-header: x-vercel-protection-bypass=VERCEL_AUTOMATION_BYPASS_SECRET",
    );
    expect(yaml).toContain(
      "VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}",
    );
  });
});

describe("aletheia init — argumentos", () => {
  it("defaults: jornada e workflow nos caminhos do piloto, 12 rotas, profundidade 2", () => {
    const args = parseInitArgs(["--url", "https://loja.exemplo"]);
    expect(args).toMatchObject({
      url: "https://loja.exemplo",
      journeyOut: ".aletheia/jornada.json",
      workflowOut: ".github/workflows/aletheia.yml",
      aletheiaRef: "main",
      maxRoutes: 12,
      maxDepth: 2,
      secretHeader: null,
      routes: null,
    });
  });

  it("--workflow none desliga o YAML; --routes dispensa a descoberta", () => {
    const args = parseInitArgs([
      "--url",
      "https://loja.exemplo",
      "--workflow",
      "none",
      "--routes",
      "/, /sobre ,/contato",
    ]);
    expect(args.workflowOut).toBeNull();
    expect(args.routes).toEqual(["/", "/sobre", "/contato"]);
  });

  it("recusa URL inválida e limites não positivos", () => {
    const invalid = expect.objectContaining({ code: "CAPTURE_INVALID" }) as Error;
    expect(() => parseInitArgs(["--url", "loja"])).toThrowError(invalid);
    expect(() => parseInitArgs(["--url", "https://x.y", "--max-routes", "0"])).toThrowError(
      invalid,
    );
  });
});
