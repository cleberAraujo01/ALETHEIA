/**
 * Corpus `excalidraw` — os PRs, POR NÚMERO.
 *
 * Cinco PRs do excalidraw/excalidraw, escolhidos em 2026-09-22. O que este
 * corpus tem que nenhum outro tem: a Vercel registra um deployment na API do
 * GitHub para CADA commit da `master`, então a base de cada PR é o preview do
 * merge-base exato — não a `main` de hoje, como no vite-docs. Base e head
 * diferem SÓ pelo PR. Todo delta é do PR, da própria aplicação (não
 * determinismo) ou do motor; drift não existe por construção.
 *
 * Todos são `MUDANCA_LEGITIMA`: nenhum delta é regressão por construção,
 * todo bloqueante é falso positivo. O que muda entre eles é ONDE o PR deveria
 * aparecer na jornada (`visivel`): as observações em que um delta de DOM pode
 * ser do PR. Fora delas, um delta de DOM não pode ser do PR — e o rotulador
 * fecha para baixo.
 *
 *  - #12143, #12125, #12124: mesclados por mantenedores, tocam lógica de
 *    elementos (binding, duplicação). INVISÍVEIS à jornada — a expectativa é
 *    zero delta de DOM. É o placar de falso positivo mais puro possível: par
 *    exato, PR que não toca a UI.
 *  - #12076: campo de busca no diálogo de ajuda. Visível em `help-dialog`.
 *    Traz chaves novas em `locales/en.json`; a UI aqui é pt-BR, então a
 *    string nova cai no fallback em inglês — visível do mesmo jeito.
 *  - #12139: nome do arquivo na UI (`EditableFileName` em `LayerUI`). Pode
 *    aparecer em qualquer observação, já que LayerUI está em todas.
 *
 * `PISO_SHA` é a base compartilhada por dois dos cinco PRs, capturada duas
 * vezes: mesma build, nada é mudança por construção.
 */

export const REPO = "excalidraw/excalidraw";

export const PISO_SHA = "97c68dd";

export const PRS = {
  12143: {
    tipo: "MUDANCA_LEGITIMA",
    titulo: "fix(editor): Tab convert bound arrow update",
    baseSha: "97c68dd",
    visivel: [],
  },
  12125: {
    tipo: "MUDANCA_LEGITIMA",
    titulo: "refactor(editor): split out duplication logic into App.duplicate.ts",
    baseSha: "14e1c61",
    visivel: [],
  },
  12124: {
    tipo: "MUDANCA_LEGITIMA",
    titulo: "feat(packages/excalidraw): support onDuplicate replacements, vetoes and lookups",
    baseSha: "c0ad61c",
    visivel: [],
  },
  12076: {
    tipo: "MUDANCA_LEGITIMA",
    titulo: "fix: Add search/filter to HelpDialog for Ctrl+F support (issue #9276)",
    baseSha: "afa3a65",
    visivel: ["help-dialog"],
  },
  12139: {
    tipo: "MUDANCA_LEGITIMA",
    titulo: "Display filename on UI",
    baseSha: "97c68dd",
    visivel: ["home", "main-menu", "help-dialog", "more-tools"],
  },
};
