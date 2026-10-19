---
name: kalainne-archify
description: Mapas verificados da Kalainne com Archify para Cursor local, projetos Cursor, Claude Code, Codex, OpenCode e Cursor Cloud. Use when the user asks for Kalainne architecture, workflow, sequence, data flow, lifecycle, system maps, or to connect this repo to desktop IDEs and cloud agents.
license: MIT
metadata:
  version: "1.0.0"
  author: kaairofelipedev
---

# Kalainne Archify

Produza um mapa verificado. O CLI do Archify aceita o JSON. O HTML só existe depois do `deliver`.

## Achar o CLI

1. Se o workspace atual tem `archify/bin/archify.mjs`, use esse arquivo. É o caso deste repositório e do Cloud Agent.
2. Senão, leia `archify-root.json` nesta pasta. Com `resolution` igual a `recorded-root`, o binário é `<archifyRoot>/<archifyBin>`.
3. Se nenhum dos dois existir, pare e peça:

```bash
node integrations/kalainne/bin/install.mjs install --scope project --target .
```

Não baixe outro Archify e não invente um caminho.

## Quando desenhar

Use `architecture`, `workflow`, `sequence`, `dataflow` ou `lifecycle`. No máximo 12 nós no caminho principal. Rode `guide` se o tipo não estiver claro.

```bash
node <bin> guide "<cenário>" --json
node <bin> validate <tipo> <arquivo.json> --quality showcase --json
node <bin> deliver <tipo> <arquivo.json> <saida.html> --quality showcase --json
```

Substitua `<bin>` pelo arquivo resolvido acima. Workflow novo usa `schema_version` 2. Os outros tipos usam `schema_version` 1. Uma saída diferente de zero não é entrega.

## Fontes

- Marca: Central de Marca no Notion.
- Estratégia: Hub Estratégico 2026.
- Execução: PMO e cronograma.
- Artes: SOP e ARTES PORTFOLIO no Drive empresa.
- Forma do sistema: o JSON e o HTML que este CLI aceitar.

Notion e Drive continuam as fontes. O mapa não substitui conversa, CRM nem planilha.

## Limites

- Hermes fica em modo spec, sem aresta de execução.
- Conector sem autenticação ou em erro não entra como caminho ativo.
- Publicar, gastar dinheiro ou enviar mensagem externa espera aprovação humana. A saída padrão é rascunho.
- Mapas já aceitos neste fork: `integrations/kalainne/sources/`.
