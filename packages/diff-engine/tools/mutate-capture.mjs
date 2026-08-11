/**
 * Injeta regressões conhecidas numa captura real, produzindo uma build "head"
 * sintética e o gabarito do que deve ser detectado.
 *
 * Por que isso existe: medir recall exige saber a resposta certa. Contra uma
 * aplicação de terceiro não há como introduzir um defeito no deploy — mas há
 * como introduzi-lo no artefato observado, que é o que o motor consome. É a
 * metodologia que §7 do CLAUDE.md pede para `diff-engine` e `selector-engine`:
 * "corpus de páginas reais com mutações conhecidas".
 *
 * O que este script NÃO mede: a captura em si. Se o capturador enxergou a
 * página errada, a mutação é aplicada sobre a observação errada e o número sai
 * bonito e falso. Isso é medido separadamente, pelo diff base-contra-base.
 *
 *   node mutate-capture.mjs <captura.json> <saída.json>
 */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const [, , input, output] = process.argv;
if (!input || !output) {
  process.stderr.write("uso: node mutate-capture.mjs <captura.json> <saída.json>\n");
  process.exit(2);
}

const source = resolve(input);
const target = resolve(output);
const capture = JSON.parse(readFileSync(source, "utf8"));
const applied = [];

const walk = (node, visit, parent = null) => {
  if (node === null) return;
  visit(node, parent);
  for (const child of node.children ?? []) walk(child, visit, node);
};

const findNode = (observation, predicate) => {
  let found = null;
  let owner = null;
  walk(observation.dom, (node, parent) => {
    if (found === null && predicate(node)) {
      found = node;
      owner = parent;
    }
  });
  return { node: found, parent: owner };
};

const observationOf = (id) => capture.observations.find((o) => o.observationId === id);

const record = (id, description, expectedKind, observationId, detail) =>
  applied.push({ id, description, expectedKind, observationId, detail });

// ── M1 — link de conversão removido ──────────────────────────────────────────
{
  const observation = observationOf("home");
  const { node, parent } = findNode(
    observation,
    (n) => n.tag === "a" && (n.attributes.href ?? "").includes("wa.me"),
  );
  if (node && parent) {
    parent.children = parent.children.filter((child) => child !== node);
    record("M1", "link de WhatsApp (conversão) removido", "DOM_NODE_REMOVED", "home", node.accessibleName ?? "");
  }
}

// ── M2 — texto alterado ──────────────────────────────────────────────────────
{
  const observation = observationOf("escolinha");
  const { node } = findNode(observation, (n) => n.text !== null && n.text.length > 40);
  if (node) {
    const before = node.text;
    node.text = `${node.text.slice(0, 20)} TEXTO ALTERADO`;
    record("M2", "texto de conteúdo alterado", "DOM_TEXT_CHANGED", "escolinha", before.slice(0, 40));
  }
}

// ── M3 — controle nasce desabilitado ─────────────────────────────────────────
{
  const observation = observationOf("contato");
  const { node } = findNode(observation, (n) => n.tag === "button" || n.role === "button");
  if (node) {
    node.attributes.disabled = "";
    record("M3", "controle passou a nascer desabilitado", "DOM_ATTRIBUTE_ADDED", "contato", node.accessibleName ?? "");
  }
}

// ── M4 — destino de link trocado ─────────────────────────────────────────────
{
  const observation = observationOf("canais");
  const { node } = findNode(
    observation,
    (n) => n.tag === "a" && (n.attributes.href ?? "").startsWith("http"),
  );
  if (node) {
    const before = node.attributes.href;
    node.attributes.href = "https://destino-errado.example/";
    record("M4", "href apontando para destino errado", "DOM_ATTRIBUTE_CHANGED", "canais", before);
  }
}

// ── M5 — imagem trocada ──────────────────────────────────────────────────────
{
  const observation = observationOf("time");
  const { node } = findNode(observation, (n) => n.tag === "img" && n.attributes.src);
  if (node) {
    const before = node.attributes.src;
    node.attributes.src = "/_next/image?url=%2Fimagem-errada.png&w=640&q=75";
    record("M5", "src de imagem trocado", "DOM_ATTRIBUTE_CHANGED", "time", before.slice(0, 40));
  }
}

// ── M6 — documento passou a responder 500 ────────────────────────────────────
{
  const observation = observationOf("parceiros");
  const exchange = observation.network.find((e) => e.resourceType === "document");
  if (exchange) {
    exchange.status = 500;
    record("M6", "documento passou a responder 500", "STATUS_CHANGED", "parceiros", exchange.url);
  }
}

// ── M7 — N+1 emergente ───────────────────────────────────────────────────────
{
  const observation = observationOf("quem-somos");
  const exchange = observation.network.find((e) => e.resourceType === "image");
  if (exchange) {
    // A MESMA url, repetida. Gerar urls distintas simularia outra coisa —
    // requisições novas —, que é justamente o que o motor reporta como
    // REQUEST_ADDED. N+1 é cardinalidade da mesma chamada.
    for (let index = 0; index < 7; index += 1) {
      observation.network.push({ ...exchange });
    }
    record("M7", "mesma requisição repetida 8× (N+1 emergente)", "REQUEST_COUNT_CHANGED", "quem-somos", exchange.url.slice(0, 60));
  }
}

// ── M8 — regressão visual ────────────────────────────────────────────────────
// Repinta um bloco no screenshot para simular componente que quebrou de layout.
{
  const observation = observationOf("home");
  if (observation.screenshot) {
    const { PNG } = await import("pngjs");
    const sourceImage = resolve(dirname(source), observation.screenshot.path);
    const targetImage = resolve(dirname(target), observation.screenshot.path);
    mkdirSync(dirname(targetImage), { recursive: true });

    const png = PNG.sync.read(readFileSync(sourceImage));
    const box = { x: 120, y: 400, width: 500, height: 220 };
    for (let y = box.y; y < box.y + box.height && y < png.height; y += 1) {
      for (let x = box.x; x < box.x + box.width && x < png.width; x += 1) {
        const offset = (y * png.width + x) * 4;
        png.data[offset] = 220;
        png.data[offset + 1] = 30;
        png.data[offset + 2] = 30;
        png.data[offset + 3] = 255;
      }
    }
    writeFileSync(targetImage, PNG.sync.write(png));
    record("M8", "bloco repintado no screenshot", "VISUAL_REGION_CHANGED", "home", JSON.stringify(box));
  }
}

// Screenshots não mutados são copiados para que o head continue completo.
for (const observation of capture.observations) {
  if (!observation.screenshot) continue;
  const from = resolve(dirname(source), observation.screenshot.path);
  const to = resolve(dirname(target), observation.screenshot.path);
  if (existsSync(to)) continue;
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

capture.captureId = `${capture.captureId}_mutated`;
capture.target.label = "head-mutado";
capture.target.commit = "mutacao-sintetica";

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(capture, null, 2)}\n`);
writeFileSync(join(dirname(target), "gabarito.json"), `${JSON.stringify(applied, null, 2)}\n`);

process.stdout.write(`${applied.length} mutações aplicadas\n`);
for (const mutation of applied) {
  process.stdout.write(`  ${mutation.id}  ${mutation.expectedKind.padEnd(24)} ${mutation.observationId.padEnd(12)} ${mutation.description}\n`);
}
