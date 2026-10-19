# Kalainne Archify — instalação local e nuvem

Data: 2026-10-19

## Problema

Os mapas verificados em `integrations/kalainne/` existem neste fork, mas o desktop do Kairo, os outros projetos do Cursor e os agentes na nuvem não descobrem o contrato sozinhos. Sem um skill no diretório que a IDE varre, cada sessão reexplica a Kalainne e pode desenhar Hermes, conectores sem autenticação ou memória de chat como se fossem arquitetura ativa.

## Resultado

Um instalador zero-dependência grava um skill fino e uma regra de projeto. O skill aponta para o CLI que já está em `archify/bin/archify.mjs`. O mesmo texto vale para Cursor no desktop, para qualquer projeto Cursor, para agentes que leem `.agents/skills/` (Claude Code, Codex e OpenCode incluídos nessa convenção) e para o Cloud Agent, que recebe os arquivos commitados neste repositório.

## Abordagens

1. **Só documentação.** Já está no README. Não entra na lista de skills do desktop nem viaja com outro repositório.
2. **Skill fino + instalador, CLI permanece neste checkout.** Recomendada. Um diretório pequeno é copiado para `.agents/skills/kalainne-archify`. O renderizador não é duplicado. A nuvem usa o CLI do próprio clone.
3. **Copiar o skill inteiro do Archify para cada projeto.** Reproduz o zip, fica defasado em relação a este fork e mistura o contrato da Kalainne com o renderer.

A opção 2 é a que este spec implementa.

## Resolução do CLI

O agente escolhe o binário nesta ordem:

1. `archify/bin/archify.mjs` dentro do workspace atual. É o caminho da nuvem e de quem trabalha neste repositório.
2. `archify-root.json` ao lado do skill, com `resolution: "recorded-root"` e o caminho absoluto deste checkout. É o caminho de outro projeto no desktop, depois do instalador.
3. Parar e pedir `node integrations/kalainne/bin/install.mjs`. Não inventar outro binário e não chamar rede para baixar o Archify.

## Superfícies

| Onde | O que o instalador grava |
|---|---|
| Projeto (`--scope project`) | `<target>/.agents/skills/kalainne-archify/` e `<target>/.cursor/rules/kalainne-archify.mdc` |
| Desktop (`--scope user`) | `<home>/.agents/skills/kalainne-archify/` e `<home>/.cursor/skills/kalainne-archify/` |
| Nuvem | Os mesmos arquivos de projeto, commitados na raiz deste repositório, com `resolution: "workspace"` |

Cursor varre `.agents/skills/` e `.cursor/skills/` no projeto e no usuário. A regra `alwaysApply` cobre a sessão mesmo quando o skill não é aberto. O kit não promete `~/.cursor/skills` como único lugar global: o canônico do usuário é `~/.agents/skills/`, e a cópia em `~/.cursor/skills/` existe porque o Cursor também varre essa pasta.

Claude Code, Codex e OpenCode recebem o skill de projeto por `.agents/skills/`. Este kit não grava pasta exclusiva de cada um.

## Contrato que o skill carrega

- Notion e Drive continuam as fontes. O Archify compila o mapa.
- Hermes fica em modo spec, sem aresta operacional.
- Conector em `needsAuth` ou `error` não vira caminho ativo.
- `validate` e `deliver` em `showcase` são a aceitação. Saída diferente de zero não é entrega.
- Publicar, gastar ou enviar mensagem continua com aprovação humana.

## Fora de escopo

- Instalar o skill upstream `archify` por `npx skills`.
- Traduzir a interface do viewer para `pt-BR`.
- Ligar n8n, WhatsApp ou Supermemory.
- Escrever no Notion a partir do instalador.
- Alterar renderer, schema ou viewer.

## Prova

`node --test integrations/kalainne/test/install.test.mjs` instala em diretórios temporários, nunca no home real, e confere os caminhos, o JSON de raiz e a idempotência. `doctor --json` neste repositório resolve `workspace` e executa `archify doctor`.
