/**
 * Corpus `vite-docs` — os PRs, POR NÚMERO.
 *
 * Quatro PRs abertos do vitejs/vite em 2026-08-17, cada um com deploy preview
 * público (Netlify). Base = produção (vite.dev, `main`); head = preview.
 * Metadados brutos (título, shas, arquivos) em `prs/<n>.json`, gravados por
 * `capture.mjs` via `gh api` no momento da captura.
 *
 * DUAS NATUREZAS, e a segunda não estava no plano:
 *
 *  - `MUDANCA_LEGITIMA`: PR de documentação mesclável. Nenhum delta é
 *    regressão por construção; o rotulador decide INTENDED_CHANGE (do PR, ou
 *    drift da `main` que a produção já mostra e o preview ainda não) versus
 *    NOISE (motor ou terceiro). Todo bloqueante é falso positivo.
 *
 *  - `DEFEITO`: o preview do #23201 é uma build quebrada DE VERDADE. O PR
 *    ("fail docs build when SSR errors are detected") existe porque o
 *    `vitepress` novo quebrava páginas sem falhar o build — e o preview dele
 *    é exatamente essa build: o menu de idiomas não renderiza em nenhuma
 *    página, o console tem `TypeError … reading 'value'` e "Hydration
 *    completed but contains mismatches", e a requisição de ícones perde o
 *    ícone `languages`. Confirmado no HTML servido (`VPNavBarTranslations`
 *    ausente só neste preview) e comparado com os outros três, que têm o
 *    menu. Origem `HISTORICO`: regressão real de projeto real, não injetada,
 *    encontrada num PR aberto sem uma linha de teste escrita.
 *
 * `pixel: true` marca defeito com efeito visual comprovado; delta VISUAL só é
 * atribuído a esses, na mesma observação (regra herdada do oscar).
 */

export const PRS = {
  23230: {
    tipo: "MUDANCA_LEGITIMA",
    titulo: "docs: document server.preTransformRequests",
    arquivos: ["docs/config/server-options.md"],
  },
  23237: {
    tipo: "MUDANCA_LEGITIMA",
    titulo: "docs: document keepProcessEnv in the environment options",
    arquivos: ["docs/guide/api-environment.md"],
  },
  23092: {
    tipo: "MUDANCA_LEGITIMA",
    titulo: "docs: explain monorepo watch setup",
    arquivos: ["docs/config/server-options.md"],
  },
  23201: {
    tipo: "DEFEITO",
    titulo: "test(docs): fail docs build when SSR errors are detected",
    arquivos: [
      "docs/package.json",
      "patches/vitepress.patch",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "scripts/test-docs.sh",
    ],
    defeitos: [
      {
        id: "V1-menu-de-idiomas-nao-renderiza",
        origem: "HISTORICO",
        descricao:
          "O componente de tradução do cabeçalho (VPNavBarTranslations) não renderiza em nenhuma página: " +
          "some a lista de idiomas e o botão 'Change language'; o console mostra 'TypeError: Cannot read " +
          "properties of undefined (reading 'value')' e 'Hydration completed but contains mismatches'; a " +
          "requisição de ícones ao iconify perde o ícone `languages`.",
        pixel: true,
      },
    ],
  },
};

/** `docs/config/server-options.md` → `/config/server-options`; `docs/guide/index.md` → `/guide/`. */
export function routeOfDocFile(file) {
  const m = /^docs\/(.+)\.md$/.exec(file);
  if (m === null) return null;
  const path = `/${m[1]}`.replace(/\/index$/, "/");
  return path === "/index" ? "/" : path;
}
