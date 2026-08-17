# Shim GitHub Actions

Um runner, muitos shims (PA-11). Este shim faz **três coisas**: autentica com o
token do próprio job, invoca `aletheia run`, publica o resultado no formato
nativo — comentário no PR, step summary e artefato `aletheia-run`. **Nenhuma
decisão vive aqui**: jornada, limiar, supressão, o que bloqueia — tudo é do
runner (`shims/cli`), que é a fonte da verdade para todo shim.

Códigos de saída do runner (RN-CI-005): `0` sem regressão, `1` regressão (job
vermelho), `2` **falha da plataforma → job verde com aviso**. Problema nosso
nunca reprova o PR do cliente.

## Uso no repositório do cliente

O oráculo O5 compara duas builds. Numa aplicação publicada na Vercel (ou em
qualquer provedor que crie um deploy por PR), a build candidata é a URL de
preview do PR e a referência é a produção — ou o preview do commit base, se
existir. O gatilho mais simples é o evento de deploy bem-sucedido:

```yaml
# .github/workflows/aletheia.yml
name: ALETHEIA
on:
  deployment_status:
jobs:
  regressao:
    if: github.event.deployment_status.state == 'success' && github.event.deployment_status.environment != 'Production'
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions: { contents: read, pull-requests: write }
    steps:
      - uses: actions/checkout@v4
      - uses: cleberAraujo01/ALETHEIA/shims/github-action@main
        with:
          base-url: https://sua-app.exemplo.com                       # produção
          head-url: ${{ github.event.deployment_status.environment_url }}  # preview do PR
          journey: .aletheia/jornada.json
```

Sem PR associado ao deploy, o comentário não é publicado (não há onde) e o
resultado fica no step summary e no artefato.

`journey` é IR v1 (ações + observações; ver README da raiz) ou, no caso mais
simples, uma lista de rotas no formato legado — que é migrada na leitura:

```json
{ "journeyVersion": "0.1.0", "name": "smoke", "viewport": { "width": 1280, "height": 800 },
  "observations": [ { "observationId": "home", "path": "/" }, { "observationId": "contato", "path": "/contato" } ] }
```

## Entradas

| Entrada | Obrigatória | Default | Nota |
|---|---|---|---|
| `base-url` | sim | — | build de referência |
| `head-url` | sim | — | build candidata |
| `journey` | sim | — | caminho no repositório do cliente |
| `aletheia-ref` | não | `main` | ref do runner a usar; fixe uma tag em produção |
| `env` | não | `pull-request` | vai para os metadados do relatório |
| `confidence-mode` | não | `SHARED_DEGRADED` | declare `ISOLATED` só se as duas builds não compartilham nada (RN-EXE-007) |
| `suppressions` | não | — | arquivo de supressão aprendida do projeto; só regras `ACTIVE` valem |
| `comment` | não | `true` | `false` para só publicar no summary/artefato |
| `token` | não | `github.token` | precisa de `pull-requests: write` para comentar |

## O que ele NÃO faz, de propósito

- Não decide nada. Não tem `if` sobre arquivos alterados, severidade, rota.
- Não chama modelo nenhum. O comentário é o relatório em Markdown (PA-01).
- Não esconde falha de plataforma atrás de "sucesso" nem de "falha": ela sai
  como aviso, com o código.
