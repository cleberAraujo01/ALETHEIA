import { chromium } from "playwright";

/**
 * Descoberta de rotas para o kit de onboarding (`aletheia init`).
 *
 * Abre a aplicação num browser real, lê os links da mesma origem e segue em
 * largura até `maxDepth`, parando em `maxRoutes`. O resultado é a lista de
 * caminhos que uma jornada por URL vai observar — o mínimo para um piloto
 * entrar sem escrever nada à mão.
 *
 * O que fica de fora, de propósito: query string e fragmento (a mesma página
 * com `?nome=a` e `?nome=b` é uma rota), arquivos (`.pdf`, `.jpg`…), `mailto:`
 * e `tel:`, e qualquer origem que não a da aplicação. Ordem: a home primeiro,
 * o resto em ordem alfabética — determinística por construção, não pela
 * ordem em que o DOM listou os links.
 *
 * Nenhuma heurística de "rota interessante": isso é decisão de quem lê a
 * jornada gerada. O `init` mostra a lista e o humano apaga o que não quer.
 */
export interface DiscoverOptions {
  readonly url: string;
  /** Limite de rotas devolvidas (a home conta). Hipótese: 12 cabe em ~1 min de captura. */
  readonly maxRoutes: number;
  /** Profundidade da busca em largura a partir da home. */
  readonly maxDepth: number;
  /** Orçamento de carregamento por página — o mesmo deadline da convergência. */
  readonly deadlineMs: number;
}

export interface DiscoveredRoute {
  readonly path: string;
  readonly depth: number;
  /** Página em que o link foi encontrado. `null` para a home. */
  readonly foundOn: string | null;
}

export interface DiscoverResult {
  readonly routes: readonly DiscoveredRoute[];
  /** Páginas efetivamente abertas. */
  readonly visited: number;
  /** Links descartados, com o motivo — para o humano ver o que ficou fora. */
  readonly skipped: readonly { readonly href: string; readonly reason: string }[];
  /** Rotas que existiam além de `maxRoutes` e não entraram. */
  readonly truncated: number;
  readonly browserVersion: string;
}

const FILE_EXTENSION =
  /\.(pdf|jpe?g|png|gif|webp|svg|ico|css|js|mjs|json|xml|txt|zip|mp4|mp3|woff2?)$/i;

/** Caminho canônico de um link da mesma origem, ou o motivo de ficar fora. */
export function classifyLink(
  href: string,
  origin: string,
): { readonly path: string } | { readonly reason: string } {
  if (/^(mailto|tel|javascript):/i.test(href))
    return { reason: "não é rota (mailto/tel/javascript)" };
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return { reason: "URL inválida" };
  }
  if (url.origin !== origin) return { reason: "outra origem" };
  if (FILE_EXTENSION.test(url.pathname)) return { reason: "arquivo, não página" };
  const path = canonicalPath(url.pathname);
  return { path };
}

/** `/quem-somos/` → `/quem-somos`; `//a` → `/a`; `/` fica `/`. */
export function canonicalPath(pathname: string): string {
  const collapsed = pathname.replace(/\/{2,}/g, "/");
  if (collapsed === "/") return "/";
  return collapsed.replace(/\/+$/, "") || "/";
}

export async function discoverRoutes(options: DiscoverOptions): Promise<DiscoverResult> {
  const start = new URL(options.url);
  const origin = start.origin;
  const home = canonicalPath(start.pathname);

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ locale: "pt-BR", timezoneId: "UTC" });
    context.setDefaultTimeout(options.deadlineMs);
    const page = await context.newPage();

    const found = new Map<string, DiscoveredRoute>();
    const skipped: { href: string; reason: string }[] = [];
    const skippedSeen = new Set<string>();
    const queue: DiscoveredRoute[] = [{ path: home, depth: 0, foundOn: null }];
    found.set(home, queue[0] as DiscoveredRoute);
    let visited = 0;

    while (queue.length > 0) {
      const current = queue.shift() as DiscoveredRoute;
      if (current.depth >= options.maxDepth) continue;
      try {
        // `networkidle` é sinal de rede, não espera fixa: links que uma página
        // monta a partir de um fetch (catálogo em JSON, menu de CMS) só existem
        // no DOM depois que a rede sossega. O `load` chegaria antes deles.
        await page.goto(`${origin}${current.path}`, { waitUntil: "networkidle" });
      } catch {
        // Página que não carrega no orçamento não é erro do init: fica na
        // jornada (é uma rota que existe) e a captura vai dizer o que houve.
        continue;
      }
      visited += 1;
      const hrefs = await page.$$eval("a[href]", (anchors) =>
        anchors.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""),
      );
      for (const href of hrefs) {
        if (href === "" || href.startsWith("#")) continue;
        const verdict = classifyLink(href, origin);
        if ("reason" in verdict) {
          if (!skippedSeen.has(href)) {
            skippedSeen.add(href);
            skipped.push({ href, reason: verdict.reason });
          }
          continue;
        }
        if (found.has(verdict.path)) continue;
        const route = { path: verdict.path, depth: current.depth + 1, foundOn: current.path };
        found.set(verdict.path, route);
        queue.push(route);
      }
    }

    const all = [...found.values()].sort((a, b) =>
      a.path === home ? -1 : b.path === home ? 1 : a.path.localeCompare(b.path),
    );
    const routes = all.slice(0, options.maxRoutes);
    return {
      routes,
      visited,
      skipped,
      truncated: all.length - routes.length,
      browserVersion: `chromium/${browser.version()}`,
    };
  } finally {
    await browser.close();
  }
}
