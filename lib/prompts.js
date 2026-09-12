const discoveryPrompt = `
List all root directories. Read every package.json, go.mod, Cargo.toml, requirements.txt, pyproject.toml, and .env.example. Extract:
1. The main entry point file paths.
2. All external dependency names.
3. The folder structure tree (max depth 4).
Output as plain bullet points. No commentary.
`;

const depsPrompt = `
Using the folder structure from discovery.txt, read ALL source files (.ts, .py, .go, .js, .rs, .java). For each file, extract:
- Absolute import paths.
- Exported classes, functions, or structs.
- Decorators, middleware, or route annotations.
Do NOT summarize what the code does. Just output the raw import/export map grouped by file path.
`;

function getSynthesisPrompt(discovery, deps) {
  return `
You are an architecture expert. Using the attached data below, generate the strict Archify JSON IR.

Rules:
- Group files into exactly 8-12 runtime components based on their imports/exports.
- Identify the single primary request/event path through the system.
- Mark any external service as an 'external' node with a clearly defined trust boundary.
- Put all supporting details into descriptive 'cards' (node metadata), NOT as extra edges.
- Output ONLY valid Archify JSON IR. Do not add markdown formatting.

Discovery data:
${discovery}

Dependency map:
${deps}
`;
}

module.exports = { discoveryPrompt, depsPrompt, getSynthesisPrompt };
