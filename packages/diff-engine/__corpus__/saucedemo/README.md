# Corpus `saucedemo`

Terceiro corpus de referência do Diff Engine, e o primeiro **com ações**:
[Sauce Demo](https://www.saucedemo.com), a loja de demonstração da Sauce Labs,
feita para automação. O mesmo app é servido com **defeitos deliberados conforme
o usuário logado** — a base é o `standard_user`; `locked_out_user`,
`problem_user`, `error_user` e `visual_user` são quatro "builds head", cada uma
com os defeitos que a Sauce Labs mantém de propósito.

Resultado e leitura: [`docs/medicao-fase-1.md`](../../../../docs/medicao-fase-1.md) §7.

## Por que este corpus

| | `juventude` | `oscar` | `saucedemo` |
|---|---|---|---|
| Como se chega às telas | URL | URL | **login, ordenação, carrinho, checkout** (IR com ações) |
| Origem dos defeitos | commits nossos + injetados | commits upstream + injetados | **mantidos pelo próprio app** (`origem: DEMO`) |
| Onde roda | build local | sandbox local | **público**, sem build nem instalação |
| O que exercita a mais | — | token CSRF | **interrupção de jornada**, consenso de seletores, erros de console causados por defeito |

Ele custa ~30 s por usuário e nenhuma instalação. É a rede de baixo para tudo o
que a Fase 1 construiu — IR, interpretador, consenso, cura, interrupção — contra
uma aplicação que ninguém desenhou para o motor.

## O que tem aqui

| Arquivo | Papel |
|---|---|
| `journey.mjs` | Gera `journeys/<usuário>.json`: a MESMA jornada de compra para todos, só o login muda. Gerador em vez de cinco arquivos à mão: divergência entre jornadas seria ruído de corpus |
| `journeys/*.json` | As jornadas IR geradas (versionadas, para a leitura) |
| `capture.mjs` | Captura cada usuário em `.aletheia/saucedemo/<usuário>/` + `standard_user-rerun` (piso) |
| `faults.mjs` | Os 11 defeitos, por usuário — fixados **depois** de observados nos relatórios, não copiados da documentação |
| `label.mjs` | Atribui cada delta ao defeito do usuário da captura head, ou a `NOISE`. Fecha para baixo |

O que **não** tem: capturas, relatórios, screenshots — pesam e se refazem em
dois minutos com `capture.mjs`.

## Estado (2026-08-17, primeira medição)

**6 de 11 defeitos bloqueados, 11 de 11 visíveis, 0% de falso positivo, piso 0.**

| Usuário | Defeitos | Bloqueados | Como |
|---|---|---|---|
| `locked_out_user` | 1 | **1** | login recusado → jornada interrompida → observações ausentes viram `OBSERVATION_REMOVED` HIGH |
| `problem_user` | 4 | **2** | link About para 404 (`href` → HIGH); sobrenome ignorado → checkout não avança → resumo sumiu, `complete` ausente. Passam: imagens 404 (`src`, MEDIUM) e ordenação ignorada (texto/ordem, MEDIUM) |
| `error_user` | 3 | **3** | Finish não conclui (nós somem); ordenação lança erro; erro no checkout — os dois últimos pelo **console**: o rastreador de erros do app dispara e o CORS do POST aparece |
| `visual_user` | 3 | **0** | layout desalinhado (classes), **preços errados** ($29.99 → $96.09) e imagem 404 — tudo MEDIUM/LOW: teto visual e texto |

Três coisas que este corpus ensinou ao motor no primeiro dia estão na §7 da
medição — uma virou código (corpo de rede não observado não é mudança de tipo:
o piso reprovava a si mesmo), uma foi recusada de propósito (rebaixar erro de
console "de terceiro": aqui ele é o sintoma do defeito), e uma ficou declarada
(lista cujos itens só têm identidade num descendente alinha por posição e
espalha um defeito de ordenação em 235 deltas).

## Reproduzir

```bash
node packages/diff-engine/__corpus__/saucedemo/journey.mjs   # regenera as jornadas
node packages/diff-engine/__corpus__/saucedemo/capture.mjs   # ~3 min, cinco usuários + rerun
pnpm corpora:medir                                            # entra na tabela dos pares
```
