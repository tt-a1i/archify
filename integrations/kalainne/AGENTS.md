# Contrato operacional — Archify na Kalainne

Leia este arquivo junto com `archify/SKILL.md` quando a tarefa for da Kalainne Professional ou do Kairo Felipe.

## Quando desenhar

Desenhe com Archify quando a tarefa falar de arquitetura, fluxo de trabalho, sequência de chamada, linhagem de dado ou ciclo de vida. Descreva o sistema em uma frase e rode `node archify/bin/archify.mjs guide "<frase>" --json` se o tipo não estiver óbvio.

Mantenha um caminho principal, no máximo 12 nós primários, e o detalhe de apoio nas fichas. Fonte de verdade por tema:

- Marca: Central de Marca no Notion.
- Estratégia: Hub Estratégico 2026.
- Execução: Cronograma e PMO Executivo.
- Artes: SOP no Drive empresa e ARTES PORTFOLIO.
- Forma verificada: o JSON e o HTML que o `deliver` aceitar.

## Quando não inventar

Escreva só relações que a fonte confirma ou que este contrato pede explicitamente como alvo. Hermes permanece em modo spec: pode aparecer isolada, com a marca de spec, e sem aresta de execução. Conector em `needsAuth` ou `error` não vira dependência desenhada como ativa.

Se faltar dono, região, gate ou caminho, deixe o fato de fora. Não ligue o perfil `deployment-ownership` para completar lacuna.

## Como entregar

1. Escolha o tipo e copie a forma de um exemplo em `archify/examples/`, com ids e texto novos.
2. Workflow novo usa `schema_version: 2`. Os outros tipos usam `schema_version: 1`.
3. Defina `meta.quality_profile` como `showcase`.
4. Valide e só então entregue:

```bash
node archify/bin/archify.mjs validate <tipo> <arquivo.json> --quality showcase --json
node archify/bin/archify.mjs deliver <tipo> <arquivo.json> <saida.html> --quality showcase --json
```

5. Uma entrega com saída diferente de zero não é sucesso. O artefato anterior permanece.
6. Devolva os caminhos exatos do JSON e do HTML. O registro no Notion guarda o link; o chat não vira arquivo canônico.

## Roteamento

Pedido do Kairo entra no Grok Bot Primary. O Primary escolhe um dono. Se a saída toca marca, o Brand Guardian emite parecer. Publicação, gasto e mensagem externa esperam aprovação humana e saem como rascunho até lá.

Cursor local e Cursor Cloud chamam este mesmo CLI. O modelo pode ser outro; o recibo do CLI é a aceitação do mapa.

## Mapas já aceitos

- `integrations/kalainne/sources/ecossistema.architecture.json`
- `integrations/kalainne/sources/roteamento.workflow.json`
- `integrations/kalainne/sources/conhecimento.dataflow.json`

Atualize esses arquivos quando a fonte no Notion mudar. Não regrave o HTML à mão.
