# Kalainne local e nuvem — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o contrato Kalainne + Archify aparecer no Cursor do desktop, em qualquer projeto, nas IDEs que leem `.agents/skills/`, e no Cloud Agent deste repositório.

**Architecture:** Um instalador Node sem dependência copia um skill fino e uma regra. O CLI continua em `archify/bin/archify.mjs`. No próprio repositório a resolução é `workspace`. Em outro projeto ou no home, a resolução é `recorded-root`.

**Tech Stack:** Node.js >= 18, `node:test`, Markdown de skill e regra Cursor.

## Global Constraints

- Zero dependência npm no instalador.
- Não gravar o home real nos testes.
- Não duplicar o renderer do Archify.
- Hermes permanece fora do caminho operacional.
- `showcase` continua sendo a aceitação dos mapas.
- Caminho canônico de skill: `.agents/skills/kalainne-archify`.
- Cópia extra só no escopo usuário: `.cursor/skills/kalainne-archify`.
- Regra de projeto: `.cursor/rules/kalainne-archify.mdc` com `alwaysApply: true`.

---

### Task 1: Skill e regra de origem

**Files:**
- Create: `integrations/kalainne/skill/SKILL.md`
- Create: `integrations/kalainne/skill/rule.mdc`

**Interfaces:**
- Consumes: contrato em `integrations/kalainne/AGENTS.md`
- Produces: arquivos copiados byte a byte pelo instalador

- [x] **Step 1:** Gravar o `SKILL.md` com o nome `kalainne-archify`, a ordem de resolução do CLI e as regras de fonte, Hermes e showcase.
- [x] **Step 2:** Gravar a regra Cursor com frontmatter `alwaysApply: true`.

### Task 2: Instalador

**Files:**
- Create: `integrations/kalainne/bin/install.mjs`
- Test: `integrations/kalainne/test/install.test.mjs`

**Interfaces:**
- Consumes: os dois arquivos da Task 1 e `archify/bin/archify.mjs`
- Produces: comando `install` e comando `doctor`

```bash
node integrations/kalainne/bin/install.mjs install --scope project --target <dir> [--json]
node integrations/kalainne/bin/install.mjs install --scope user --home <dir> [--json]
node integrations/kalainne/bin/install.mjs doctor --target <dir> [--home <dir>] [--json]
```

- [x] **Step 1:** Teste que falha se o comando não existe.
- [x] **Step 2:** Implementar a gravação idempotente dos diretórios e de `archify-root.json`.
- [x] **Step 3:** `doctor --json` devolve `resolution: "workspace"` quando o alvo contém `archify/bin/archify.mjs`.

### Task 3: Presença neste repositório

**Files:**
- Create: `.agents/skills/kalainne-archify/SKILL.md`
- Create: `.agents/skills/kalainne-archify/archify-root.json`
- Create: `.cursor/rules/kalainne-archify.mdc`
- Modify: `integrations/kalainne/README.md`
- Modify: `.github/workflows/kalainne.yml`

- [x] **Step 1:** Rodar o instalador com `--scope project --target` na raiz do repositório.
- [x] **Step 2:** Documentar os dois comandos de desktop e o fato de a nuvem já receber os arquivos commitados.
- [x] **Step 3:** O workflow roda `node --test integrations/kalainne/test/*.test.mjs`.

## Self-review

- Spec coberta: resolução, superfícies, contrato, prova e fora de escopo têm tarefa.
- Sem placeholder de implementação. O código correspondente está em `integrations/kalainne/bin/install.mjs`.
- Um único subsistema: instalação do skill. Mapas, renderer e Notion ficam como estão.
