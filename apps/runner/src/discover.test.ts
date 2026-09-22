import { createServer, type Server } from "node:http";

import { PlatformError } from "@aletheia/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { canonicalPath, classifyLink, discoverRoutes } from "./discover.js";

/**
 * Site mínimo com o que o crawler precisa decidir: link relativo, absoluto,
 * com query e fragmento, arquivo, outra origem, mailto, e uma rota que só
 * aparece na profundidade 2.
 */
const PAGES: Record<string, string> = {
  "/": `<a href="/sobre">Sobre</a>
        <a href="/contato/">Contato</a>
        <a href="/sobre?utm=x#topo">Sobre de novo</a>
        <a href="/catalogo.pdf">PDF</a>
        <a href="https://exemplo.invalido/fora">Fora</a>
        <a href="mailto:a@b.c">Mail</a>
        <a href="#">Âncora</a>`,
  "/sobre": `<a href="/equipe">Equipe</a>`,
  "/contato": `<a href="/">Home</a>`,
  "/equipe": `<a href="/equipe/historia">História</a>`,
  "/equipe/historia": ``,
};

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  server = createServer((request, response) => {
    const path =
      new URL(request.url ?? "/", "http://localhost").pathname.replace(/\/+$/, "") || "/";
    const body = PAGES[path];
    if (body === undefined) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><body>${body}</body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new PlatformError("INTERNAL_INVARIANT_BROKEN", { reason: "servidor sem porta" });
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

describe("classifyLink e canonicalPath", () => {
  const origin = "https://app.exemplo";
  it("query e fragmento não fazem rota nova; barra final some; a raiz fica", () => {
    expect(classifyLink("/sobre?utm=x#topo", origin)).toEqual({ path: "/sobre" });
    expect(classifyLink("/contato/", origin)).toEqual({ path: "/contato" });
    expect(classifyLink("/", origin)).toEqual({ path: "/" });
    expect(canonicalPath("//a//b/")).toBe("/a/b");
  });
  it("arquivo, outra origem e mailto ficam de fora com o motivo", () => {
    expect(classifyLink("/catalogo.pdf", origin)).toEqual({ reason: "arquivo, não página" });
    expect(classifyLink("https://outra.origem/x", origin)).toEqual({ reason: "outra origem" });
    expect(classifyLink("mailto:a@b.c", origin)).toEqual({
      reason: "não é rota (mailto/tel/javascript)",
    });
  });
});

describe("discoverRoutes", () => {
  it("home primeiro, resto em ordem alfabética, sem duplicar por query — profundidade respeitada", async () => {
    const result = await discoverRoutes({
      url: baseUrl,
      maxRoutes: 12,
      maxDepth: 2,
      deadlineMs: 15_000,
    });
    expect(result.routes.map((r) => r.path)).toEqual(["/", "/contato", "/equipe", "/sobre"]);
    expect(result.routes.find((r) => r.path === "/equipe")?.foundOn).toBe("/sobre");
    // `/equipe/historia` está na profundidade 3: fora, e não é erro.
    expect(result.routes.some((r) => r.path === "/equipe/historia")).toBe(false);
    expect(result.skipped.map((s) => s.reason).sort()).toEqual([
      "arquivo, não página",
      "não é rota (mailto/tel/javascript)",
      "outra origem",
    ]);
    expect(result.truncated).toBe(0);
    expect(result.browserVersion).toMatch(/^chromium\//);
  }, 60_000);

  it("maxRoutes corta e declara quantas ficaram de fora", async () => {
    const result = await discoverRoutes({
      url: baseUrl,
      maxRoutes: 2,
      maxDepth: 2,
      deadlineMs: 15_000,
    });
    expect(result.routes.map((r) => r.path)).toEqual(["/", "/contato"]);
    expect(result.truncated).toBe(2);
  }, 60_000);
});
