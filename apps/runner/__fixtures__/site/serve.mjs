#!/usr/bin/env node
/**
 * Servidor estático mínimo do fixture, para demos e smokes locais.
 *   node serve.mjs [porta]   → imprime a porta na primeira linha da saída
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const requested = Number(process.argv[2] ?? "0");

const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const file = path === "/" ? "index.html" : path.slice(1);
  readFile(join(root, file))
    .then((body) => {
      response.writeHead(200, {
        "content-type": extname(file) === ".html" ? "text/html; charset=utf-8" : "text/plain",
      });
      response.end(body);
    })
    .catch(() => {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("nao encontrado");
    });
});
server.listen(requested, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write(
    `${typeof address === "object" && address !== null ? address.port : requested}\n`,
  );
});
