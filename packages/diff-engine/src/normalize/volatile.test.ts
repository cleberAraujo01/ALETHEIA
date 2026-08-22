import { describe, expect, it } from "vitest";

import { extractDeployIdentity, isDeployPlatformFurniture } from "./volatile.js";

describe("identidade de deploy declarada pelo framework (NORM-NET-011)", () => {
  it("extrai o buildId do comentário que o Next.js afixa após o doctype", () => {
    expect(
      extractDeployIdentity('<!DOCTYPE html><!--QtLyQumOsnLxPnzpPW71C--><html lang="pt-BR">'),
    ).toBe("QtLyQumOsnLxPnzpPW71C");
    // doctype minúsculo também é HTML válido
    expect(extractDeployIdentity("<!doctype html><!--b8BR8bkGafMUVJFtivFs1-->")).toBe(
      "b8BR8bkGafMUVJFtivFs1",
    );
  });

  it("não confunde marcador de template nem comentário escrito por gente", () => {
    // Vite: sem dígito. Não é identidade de nada.
    expect(extractDeployIdentity("<!DOCTYPE html><!--app-html--><html>")).toBeNull();
    // curto demais para ser buildId
    expect(extractDeployIdentity("<!DOCTYPE html><!--abc123--><html>")).toBeNull();
    // só dígito ou só letra não caracteriza token
    expect(extractDeployIdentity("<!DOCTYPE html><!--12345678901234567890-->")).toBeNull();
    expect(extractDeployIdentity("<!DOCTYPE html><!--abcdefghijklmnopqrst-->")).toBeNull();
  });

  it("só reconhece a POSIÇÃO estrutural: comentário longe do doctype não é declaração", () => {
    expect(
      extractDeployIdentity("<!DOCTYPE html><html><!--QtLyQumOsnLxPnzpPW71C--></html>"),
    ).toBeNull();
    expect(extractDeployIdentity('{"b":"QtLyQumOsnLxPnzpPW71C"}')).toBeNull();
  });
});

describe("mobília da plataforma de deploy (NORM-NET-012)", () => {
  it("reconhece o host do toolbar de preview da Vercel, e só ele", () => {
    expect(isDeployPlatformFurniture("https://vercel.live/_next-live/feedback/feedback.js")).toBe(
      true,
    );
    expect(isDeployPlatformFurniture("https://sub.vercel.live/x.js")).toBe(true);
    // a comparação é por HOST — path parecido em outro domínio não engana
    expect(isDeployPlatformFurniture("https://evil.example/vercel.live/x.js")).toBe(false);
    expect(isDeployPlatformFurniture("https://notvercel.live/x.js")).toBe(false);
    expect(isDeployPlatformFurniture("https://app.cliente.example/api")).toBe(false);
    expect(isDeployPlatformFurniture("caminho relativo sem host")).toBe(false);
  });
});
