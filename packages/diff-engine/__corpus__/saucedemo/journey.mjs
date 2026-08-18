#!/usr/bin/env node
/**
 * Corpus `saucedemo` — jornadas IR, uma por usuário.
 *
 *   node journey.mjs            → escreve journeys/<usuario>.json
 *
 * O Sauce Demo (saucedemo.com) é uma loja feita para automação: o MESMO app,
 * e usuários que deliberadamente veem versões quebradas dele. É o terceiro
 * corpus de referência e o primeiro com AÇÕES: login, ordenação, carrinho,
 * checkout — a jornada inteira atravessa IR, consenso de seletores e
 * interrupção. Base = `standard_user`; cada outro usuário é um "head" com os
 * defeitos que a Sauce Labs documenta e que `faults.mjs` fixa depois de
 * OBSERVADOS (medição antes de rotulagem, como no oscar).
 *
 * A jornada é idêntica para todos — só muda o valor digitado no login. Um
 * gerador em vez de cinco arquivos à mão: divergência entre jornadas seria
 * ruído de corpus, não de motor.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const USERS = [
  "standard_user",
  "problem_user",
  "error_user",
  "visual_user",
  "locked_out_user",
];
export const PASSWORD = "secret_sauce"; // credencial pública do demo, publicada na própria tela de login

const testId = (id, extra = {}) => ({ testId: id, ...extra });

export function journeyFor(user) {
  return {
    irVersion: "1.0.0",
    id: `jr_saucedemo_${user}`,
    name: `saucedemo-${user}`,
    viewport: { width: 1280, height: 900 },
    steps: [
      { id: "st_01", action: "navigate", path: "/" },
      { id: "st_02", action: "observe", observationId: "login" },
      {
        id: "st_03",
        action: "fill",
        target: testId("username", { placeholder: "Username" }),
        value: user,
      },
      {
        id: "st_04",
        action: "fill",
        target: testId("password", { placeholder: "Password" }),
        value: PASSWORD,
      },
      {
        id: "st_05",
        action: "click",
        target: testId("login-button", { role: "button", name: "Login" }),
      },
      { id: "st_06", action: "observe", observationId: "inventory" },
      { id: "st_07", action: "select", target: testId("product-sort-container"), value: "za" },
      { id: "st_08", action: "observe", observationId: "inventory-sorted" },
      {
        id: "st_09",
        action: "click",
        target: testId("add-to-cart-sauce-labs-backpack", { role: "button", name: "Add to cart" }),
      },
      {
        id: "st_10",
        action: "click",
        target: testId("add-to-cart-sauce-labs-bike-light", {
          role: "button",
          name: "Add to cart",
        }),
      },
      { id: "st_11", action: "observe", observationId: "inventory-added" },
      {
        id: "st_12",
        action: "click",
        target: testId("shopping-cart-link", { css: "a.shopping_cart_link" }),
      },
      { id: "st_13", action: "observe", observationId: "cart" },
      {
        id: "st_14",
        action: "click",
        target: testId("checkout", { role: "button", name: "Checkout" }),
      },
      { id: "st_15", action: "observe", observationId: "checkout-info" },
      {
        id: "st_16",
        action: "fill",
        target: testId("firstName", { placeholder: "First Name" }),
        value: "Ana",
      },
      {
        id: "st_17",
        action: "fill",
        target: testId("lastName", { placeholder: "Last Name" }),
        value: "Souza",
      },
      {
        id: "st_18",
        action: "fill",
        target: testId("postalCode", { placeholder: "Zip/Postal Code" }),
        value: "01000-000",
      },
      {
        id: "st_19",
        action: "click",
        target: testId("continue", { role: "button", name: "Continue" }),
      },
      { id: "st_20", action: "observe", observationId: "checkout-overview" },
      {
        id: "st_21",
        action: "click",
        target: testId("finish", { role: "button", name: "Finish" }),
      },
      { id: "st_22", action: "observe", observationId: "complete" },
    ],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = join(HERE, "journeys");
  mkdirSync(dir, { recursive: true });
  for (const user of USERS) {
    writeFileSync(join(dir, `${user}.json`), `${JSON.stringify(journeyFor(user), null, 2)}\n`);
  }
  process.stdout.write(`  ${USERS.length} jornada(s) em ${dir}\n`);
}
