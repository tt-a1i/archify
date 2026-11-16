# Archify no ecossistema Kalainne

Archify entra na Kalainne como o compilador de mapas verificados. O modelo propõe a forma do sistema; o CLI só entrega o HTML quando o JSON passa no schema e nas nove checagens `showcase`. Cursor local e Cursor Cloud usam o mesmo contrato e o mesmo arquivo.

Este diretório é a integração do fork `kaairofelipedev/archify`. Ele não substitui o [Hub Estratégico](https://app.notion.com/p/3398ee796579800b8d2ff8733d60cd58), a Central de Marca nem o SOP no Drive empresa.

## Papel de cada memória

| Camada | Dono | O que guarda |
|---|---|---|
| Decisão e operação | Notion | PMO, marca, CRM, FAQ Care, registro de agentes |
| Guardrail de artes | Drive empresa | SOP do agente de IA e ARTES PORTFOLIO |
| Sessão | Modelo em uso | Raciocínio da tarefa atual |
| Forma do sistema | Archify | JSON tipado e HTML com recibo de validação |

Um mapa descreve componentes, rotas e gates que foram escritos de propósito. Ele não acumula conversa, não reconcilia o Excel Master e não descobre infraestrutura ao vivo.

## O que já está desenhado

Os três mapas foram validados com `archify validate --quality showcase` (9 checagens, 0 erros, 0 avisos) e entregues com `deliver`:

| Pergunta | Tipo | Fonte | Artefato |
|---|---|---|---|
| Quem fala com quem, e onde o Archify entra? | Arquitetura | [`sources/ecossistema.architecture.json`](sources/ecossistema.architecture.json) | [`artifacts/ecossistema.architecture.html`](artifacts/ecossistema.architecture.html) |
| Como um pedido vira execução e registro? | Fluxo | [`sources/roteamento.workflow.json`](sources/roteamento.workflow.json) | [`artifacts/roteamento.workflow.html`](artifacts/roteamento.workflow.html) |
| Onde o fato nasce e quem pode publicá-lo? | Fluxo de dados | [`sources/conhecimento.dataflow.json`](sources/conhecimento.dataflow.json) | [`artifacts/conhecimento.dataflow.html`](artifacts/conhecimento.dataflow.html) |

Abra o HTML no navegador. A interface do viewer continua em inglês; os rótulos destes mapas estão em português. O schema atual aceita `locale` `en` ou `zh-CN` e não traduz a cópia autoral.

## Desktop, outros projetos e nuvem

O instalador grava o skill `kalainne-archify` sem copiar o renderer. No desktop, rode a partir deste checkout:

```bash
node integrations/kalainne/bin/install.mjs install --scope user --home "$HOME" --json
node integrations/kalainne/bin/install.mjs install --scope project --target /caminho/do/outro/projeto --json
node integrations/kalainne/bin/install.mjs doctor --target . --json
```

Para automatizar vários projetos Kalainne de uma vez:

1. Copie [`targets.example.json`](targets.example.json) para `integrations/kalainne/targets.json` (esse arquivo fica no `.gitignore`).
2. Preencha `archifyCheckout` com o caminho absoluto deste checkout e cada `projects[].path` com o clone local do produto.
3. Rode:

```bash
node integrations/kalainne/bin/bootstrap.mjs --targets integrations/kalainne/targets.json --with-user --home "$HOME" --json
node integrations/kalainne/bin/install.mjs doctor --target . --json
```

O bootstrap falha se algum path listado não existir, se `archifyCheckout` não for este repositório, ou se o `doctor` do Archify falhar. Ele é idempotente: pode rodar de novo após adicionar um projeto à lista.

O escopo `user` escreve `~/.agents/skills/kalainne-archify` e `~/.cursor/skills/kalainne-archify`. O escopo `project` escreve `.agents/skills/kalainne-archify` e `.cursor/rules/kalainne-archify.mdc`. Claude Code, Codex e OpenCode leem o skill de projeto em `.agents/skills/`.

Neste repositório a resolução é `workspace`: o CLI é `archify/bin/archify.mjs` do clone. O Cloud Agent recebe esses arquivos no checkout e não precisa do home do desktop. Em outro projeto, `archify-root.json` guarda o caminho absoluto deste checkout.

## Como pedir um mapa

No Cursor, local ou na nuvem, a partir da raiz deste repositório:

```bash
node archify/bin/archify.mjs guide "descreva o cenário" --json
node archify/bin/archify.mjs validate <tipo> <arquivo.json> --quality showcase --json
node archify/bin/archify.mjs deliver <tipo> <arquivo.json> <saida.html> --quality showcase --json
```

`<tipo>` é `architecture`, `workflow`, `sequence`, `dataflow` ou `lifecycle`. A skill instalável continua sendo a do próprio Archify (`archify/SKILL.md`). O contrato operacional da Kalainne está em [`AGENTS.md`](AGENTS.md).

Para instalar a skill no Cursor, o comando oficial do projeto é:

```bash
npx -y skills add tt-a1i/archify --skill archify --agent cursor --global --copy --yes
```

Neste fork, o agente deve ler `archify/SKILL.md` e `integrations/kalainne/AGENTS.md` juntos. O comando acima instala o upstream; ele não copia esta pasta Kalainne.

## Qual diagrama usar na Kalainne

| Situação | Tipo |
|---|---|
| Agentes, apps, Notion, Drive, Cursor e gates de aprovação | `architecture` |
| Pedido, triagem, prova, execução, rascunho e registro | `workflow` |
| Chamada entre IDE, CLI, modelo e conector | `sequence` |
| Origem de um fato, quem transforma e quem consome | `dataflow` |
| Estado de um fluxo que ainda não está em produção (spec, piloto, ativo) | `lifecycle` |

Antes de desenhar deploy, região ou dono de infraestrutura, os fatos precisam estar escritos. O perfil `deployment-ownership` recusa diagrama incompleto. Canva, Vercel, Supabase e o plugin de GitHub constavam como `needsAuth` no inventário de 06/10/2026; eles não aparecem como caminho ativo.

## Regras que os mapas já fixam

- O Grok Bot Primary tria e encaminha. O agente dono executa um job.
- Saída que toca marca passa pelo Brand Guardian.
- Publicar, gastar ou enviar mensagem externa continua com aprovação humana. A saída padrão é rascunho ou handoff.
- Hermes (n8n + WhatsApp) permanece em modo spec, sem aresta operacional. A spec está na [página Hermes](https://app.notion.com/p/3f28ee79657981de9be4e792ed793a98), atualizada em 07/10/2026.
- O HTML verificado volta ao Notion como link. O Notion segue sendo a fonte.

Agentes que o plano de 06/10/2026 nomeia e que estes mapas deixam nas fichas, para não estourar o caminho principal: Kairós Grokado, dr eggbot, Ops, Visual Pipeline, Growth, Comercial, Care e Kairo Executive. Kairós e dr eggbot já existiam como teammates. Os demais estavam especificados para criação, não confirmados um a um como bots ativos.

## Continuidade do desenvolvimento

Cada fatia abaixo cabe neste repositório e usa o CLI que já existe.

1. **Mapa por repositório de produto.** Quando `site-kalainne`, Expert Guide ou Salon Pro estiverem abertos, gerar arquitetura com evidência de commit (`meta.repository` + `--repo-root`). O recibo prova arquivo e linha; não prova que o deploy está saudável.
2. **Delta de arquitetura.** Comparar duas versões validadas do mesmo produto com `archify compare` antes de merge. O delta lista fatos incluídos, removidos, alterados e movidos. Ele não declara risco nem autoriza merge.
3. **Drift Lovable e site.** Dois mapas de arquitetura, um por superfície, e um delta entre eles. O alerta é a diferença autoral, não um crawler novo.
4. **Piso de modelo ordinário.** Rodar os cinco casos de `benchmarks/ordinary-model-floor` com o mesmo prompt, o mesmo commit e tentativa 1 congelada, para cada modelo que for escrever IR na Kalainne. O harness não chama provedor; o runner externo guarda o transcript.
5. **Locale `pt-BR` no viewer.** Traduzir só a interface fixa do viewer. Exige schema, cópia e testes do Archify. Os rótulos dos mapas da Kalainne já podem ficar em português sem essa fatia.
6. **Registro do link.** Ops anexa o HTML, ou o link do artefato, na página do projeto no Notion. Este repositório não escreve no Notion sozinho.

Ficam de fora até o Kairo confirmar a stack: importar fluxo n8n, conectar WhatsApp Business API, envio automático e qualquer dependência de Hermes em outros projetos.

## Prova local

```bash
node --test integrations/kalainne/test/maps.test.mjs
```

O teste exige os três JSON em `showcase` e confere que o HTML entregue contém o título autoral. O workflow `Kalainne maps` roda o mesmo teste quando esta pasta muda.

## Evidência usada

- [Projeto Intellig Kalainne](https://app.notion.com/p/3208ee7965798065ab8afc50ab3f1396), em andamento, lido em 19/10/2026 (edição da página em 14/10/2026).
- [Registro deste encaixe](https://app.notion.com/p/3fe8ee796579814381c8e482bf2120bf), criado em 19/10/2026 como página filha do Projeto Intellig.
- [Plano estratégico de agentes](https://app.notion.com/p/3f28ee79657981888c7cd18ce128f144), versão 1.0 de 06/10/2026.
- [Registro operacional de agentes](https://app.notion.com/p/3f28ee796579819aab45d912e985c26a), 06/10/2026.
- [Spec Hermes](https://app.notion.com/p/3f28ee79657981de9be4e792ed793a98), modo spec, edição 07/10/2026.
- [Hub estratégico](https://app.notion.com/p/3398ee796579800b8d2ff8733d60cd58), edição 16/10/2026, citado como fonte de estratégia.

Supermemory constava em erro no inventário de 06/10/2026 e nesta sessão o conector também falhou na descoberta. A integração não depende dele.
