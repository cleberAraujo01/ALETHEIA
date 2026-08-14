/**
 * Formatação — deliberadamente sem opinião discutível.
 *
 * Prettier existe aqui para que ninguém gaste um minuto de revisão com vírgula
 * e quebra de linha. Ele NUNCA reprova o CI: corrige no pre-commit e segue. Um
 * gate que reprova por formatação treina o time a ignorar gate vermelho, que é
 * exatamente o comportamento que este produto não pode induzir no cliente.
 *
 * `printWidth: 100` acompanha o código já escrito no repositório, que foi
 * formatado nessa largura desde o primeiro commit. Trocar agora produziria um
 * diff gigante sem informação nenhuma.
 */

/** @type {import("prettier").Config} */
export default {
  printWidth: 100,
  singleQuote: false,
  trailingComma: "all",
  semi: true,
  arrowParens: "always",
  endOfLine: "auto",
};
