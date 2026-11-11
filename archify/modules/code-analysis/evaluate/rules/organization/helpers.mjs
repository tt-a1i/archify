const CLI = /process\.argv|process\.exit|argparse|click\.command|commander/i;
const IO = /\b(?:readFile|writeFile|open\s*\(|Path\s*\()|(?:fs|path)\.|require\(['"](?:fs|path)/i;
const VIEW = /\b(?:render|view|template|component|jsx|html)\b/i;
const MODEL = /\b(?:class|model|domain|entity|repository|schema)\b/i;

export function roleEvidence(file) {
  const source = file.sourceText || '';
  const patterns = [['entry', CLI], ['io', IO], ['view', VIEW], ['model', MODEL]];
  return patterns.flatMap(([role, pattern]) => {
    const match = pattern.exec(source);
    if (!match) return [];
    return [{ role, line: source.slice(0, match.index).split(/\r?\n/).length, text: match[0] }];
  });
}

export function enabled(config, name, facts) {
  return config?.rules?.organization?.[name]?.enabled === true && Boolean(facts?.files?.length);
}

export function analyzedFiles(graph, facts) {
  const excluded = new Set(graph?.excluded?.roles || []);
  return (facts?.files || []).filter((file) => !excluded.has(file.role));
}

export const confidence = 0.7;
