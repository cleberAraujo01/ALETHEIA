import { describe, expect, it } from "vitest";

import { createLedger } from "./ledger.js";
import { normalizeUrl } from "./url.js";
import { NORMALIZATION_RULES } from "./volatile.js";

const opts = { selfOrigin: "http://localhost:3000" };

describe("normalização de URL por propósito", () => {
  it("alinhamento colapsa identificador de recurso no path", () => {
    const ledger = createLedger();
    expect(normalizeUrl("/orders/1042", opts, ledger)).toBe("/orders/:id");
    expect(normalizeUrl("/orders/1043", opts, ledger)).toBe("/orders/:id");
    expect(ledger.counts()[NORMALIZATION_RULES.NET_PATH_IDENTIFIER]).toBe(2);
  });

  it("valor preserva o identificador — foi o falso negativo do corpus juventude", () => {
    // Um dígito trocado no WhatsApp do clube. Com o path colapsado, base e head
    // ficavam idênticos e o defeito era invisível.
    const ledger = createLedger();
    const value = { ...opts, purpose: "VALUE" as const };
    const antes = normalizeUrl("https://wa.me/5511941126936?text=Ol%C3%A1", value, ledger);
    const depois = normalizeUrl("https://wa.me/5511941126939?text=Ol%C3%A1", value, ledger);

    expect(antes).not.toBe(depois);
    expect(antes).toContain("5511941126936");
  });

  it("origem própria some, origem de terceiro fica", () => {
    const ledger = createLedger();
    expect(normalizeUrl("http://localhost:3000/api/pedidos", opts, ledger)).toBe("/api/pedidos");
    expect(normalizeUrl("https://cdn.terceiro.com/x.js", opts, ledger)).toBe(
      "https://cdn.terceiro.com/x.js",
    );
  });
});

describe("hash de conteúdo de bundle", () => {
  const norm = (url: string, purpose?: "ALIGNMENT" | "VALUE"): string =>
    normalizeUrl(url, purpose === undefined ? opts : { ...opts, purpose }, createLedger());

  it("colapsa o hash mantendo o nome do módulo", () => {
    expect(norm("/_next/static/chunks/app/page-4f2a8c1d9b3e.js")).toBe(
      "/_next/static/chunks/app/page-<hash>.js",
    );
    expect(norm("/assets/index-DkG7f8Xz.js")).toBe("/assets/index-<hash>.js");
    expect(norm("/static/main.a1b2c3d4.css")).toBe("/static/main-<hash>.css");
  });

  it("colapsa também o número de chunk, que é posição no grafo do bundler", () => {
    expect(norm("/_next/static/chunks/528-9d84e3b3ba6f7f01.js")).toBe(
      "/_next/static/chunks/<chunk>-<hash>.js",
    );
  });

  it("módulos diferentes continuam diferentes — sumiço de arquivo ainda aparece", () => {
    expect(norm("/_next/static/chunks/app/layout-aaaa1111.js")).not.toBe(
      norm("/_next/static/chunks/app/page-bbbb2222.js"),
    );
  });

  it("não toca em imagem: trocar a arte é mudança de conteúdo, não de build", () => {
    expect(norm("/banner-paginas-20260811.webp")).toBe("/banner-paginas-20260811.webp");
  });

  it("não toca em arquivo escrito por gente, sem dígito no sufixo", () => {
    expect(norm("/js/plugin.controller.js")).toBe("/js/plugin.controller.js");
  });

  it("vale nos dois propósitos: nome de bundle não é conteúdo de negócio", () => {
    expect(norm("/assets/index-DkG7f8Xz.js", "VALUE")).toBe("/assets/index-<hash>.js");
  });
});

/**
 * Estes casos vêm da primeira aplicação DESCONHECIDA que o motor encontrou: a
 * tela de SSO da ANBIMA (Keycloak). Duas capturas da mesma build produziram
 * dois deltas bloqueantes — e os dois eram token de uso único.
 */
describe("token de uso único em query string", () => {
  const norm = (url: string): string => normalizeUrl(url, opts, createLedger());

  it("session_code do Keycloak sai do diff", () => {
    const a = norm("/login-actions/authenticate?session_code=soFbAY67UBW3_xJeR2MXrS0Kpsffb3DwmQLmt8rjfe0");
    const b = norm("/login-actions/authenticate?session_code=eBLQ3P6xie_kEuXgCoraF5NGMLKKcoyqW_bje9LpnmQ");
    expect(a).toBe(b);
    expect(a).toContain("<token>");
  });

  it("tab_id sai mesmo com 11 caracteres, porque o NOME é de protocolo", () => {
    expect(norm("/reset?tab_id=FLQAJ0n7Qoo")).toBe(norm("/reset?tab_id=OTbn5RUDMjM"));
  });

  it("state=SP continua sendo comparado — nome de protocolo, valor de negócio", () => {
    // A conjunção nome+forma existe por isto: `state` é parâmetro de OAuth e é
    // também unidade federativa numa aplicação brasileira.
    expect(norm("/busca?state=SP")).not.toBe(norm("/busca?state=RJ"));
  });

  it("id de vídeo do YouTube continua sendo comparado", () => {
    // 11 caracteres do mesmo alfabeto de token. Um piso menor que 20 apagaria a
    // troca de um vídeo na página — falso negativo criado para curar um falso
    // positivo, que é o pior negócio possível neste produto.
    expect(norm("/embed?v=dQw4w9WgXcQ")).not.toBe(norm("/embed?v=aB3dE5fG7hI"));
  });

  it("valor opaco longo sai mesmo em parâmetro de nome desconhecido", () => {
    expect(norm("/x?ticket=A7bC9dE1fG3hI5jK7lM9nO1pQ3rS5t")).toContain("<token>");
  });
});

/**
 * Segunda aplicação desconhecida: ParaBank (Java/JSP). Duas capturas da MESMA
 * build, 44 deltas, 28 bloqueantes — todos com esta única causa.
 */
describe("id de sessão como parâmetro de segmento de path", () => {
  const A = "76458CEB8D9373957D33A25A1C8CE751";
  const B = "589450F347C8E3F6E4B6116D3B3D09C9";
  const norm = (url: string, purpose?: "ALIGNMENT" | "VALUE"): string =>
    normalizeUrl(url, purpose === undefined ? opts : { ...opts, purpose }, createLedger());

  it("jsessionid sai do diff", () => {
    expect(norm(`/parabank/index.htm;jsessionid=${A}`)).toBe(
      norm(`/parabank/index.htm;jsessionid=${B}`),
    );
    expect(norm(`/parabank/index.htm;jsessionid=${A}`)).toContain("<token>");
  });

  it("sai também no propósito VALUE — foi ele que bloqueou o href e o action", () => {
    // Oposto deliberado do caso do WhatsApp: id de sessão não é conteúdo de
    // negócio, então apagá-lo no `href` não custa detecção nenhuma.
    expect(norm(`/about.htm;jsessionid=${A}`, "VALUE")).toBe(norm(`/about.htm;jsessionid=${B}`, "VALUE"));
  });

  it("destinos diferentes continuam diferentes — a regra de href não fica cega", () => {
    expect(norm(`/about.htm;jsessionid=${A}`, "VALUE")).not.toBe(
      norm(`/contact.htm;jsessionid=${A}`, "VALUE"),
    );
  });

  it("recurso estático volta a alinhar, e o hash de bundle continua sendo visto", () => {
    // Enquanto o parâmetro ficava grudado, `style.css;jsessionid=…` não terminava
    // em `.css` e o alinhamento de rede via 6 removidos + 6 adicionados.
    expect(norm(`/parabank/style.css;jsessionid=${A}`)).toBe(norm(`/parabank/style.css;jsessionid=${B}`));
    expect(norm(`/assets/index-DkG7f8Xz.js;jsessionid=${A}`)).toContain("index-<hash>.js");
  });

  it("Tomcat em cluster: o sufixo de jvmRoute vai junto", () => {
    expect(norm(`/index.htm;jsessionid=${A}.node1`)).toBe(norm(`/index.htm;jsessionid=${B}.node2`));
  });

  it("parâmetro de segmento que não é sessão continua sendo comparado", () => {
    // A lista de nomes é curta de propósito. Nome fora dela é conteúdo.
    expect(norm("/produto;cor=azul")).not.toBe(norm("/produto;cor=verde"));
    expect(norm(`/produto;sid=${A}`)).not.toBe(norm(`/produto;sid=${B}`));
  });

  it("valor curto não sai, mesmo com nome de sessão", () => {
    expect(norm("/x;sessionid=7")).not.toBe(norm("/x;sessionid=9"));
  });
});
