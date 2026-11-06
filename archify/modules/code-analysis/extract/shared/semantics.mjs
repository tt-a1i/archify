import { validSourceRange } from './source-range.mjs';
// Schema validation checks shape; these checks protect graph identity and
// references. Keep errors in the same structured format as AJV diagnostics.
export function semanticErrors(name, data) {
  const errors = [];
  const add = (path, message, params = {}) => errors.push({ path, message, params });
  const unique = (items, key, prefix) => {
    const seen = new Set();
    items.forEach((item, i) => {
      const value = item[key];
      if (seen.has(value)) add(`${prefix}/${i}/${key}`, `must be unique: ${value}`, { value });
      seen.add(value);
    });
    return seen;
  };
  if (name === 'baseline') unique(data.accepted, 'id', '/accepted');
  if (name === 'raw-facts') {
    const unresolved = data.imports.filter((edge) => !edge.resolved).length;
    if (Object.values(data.unresolved).reduce((sum, count) => sum + count, 0) !== unresolved) {
      add('/unresolved', 'counter total must match unresolved imports');
    }
    const files = unique(data.files, 'path', '/files');
    data.imports.forEach((edge, i) => {
      if (!files.has(edge.from)) add(`/imports/${i}/from`, 'must reference a recorded file');
      if (edge.resolved && !files.has(edge.to)) add(`/imports/${i}/to`, 'must reference a recorded file');
    });
    data.symbols.forEach((symbol, i) => {
      if (!files.has(symbol.file)) add(`/symbols/${i}/file`, 'must reference a recorded file');
    });
    data.functions?.forEach((fn, i) => {
      if (!files.has(fn.file)) add(`/functions/${i}/file`, 'must reference a recorded file');
      if (fn.endLine < fn.line) add(`/functions/${i}/endLine`, 'must not precede line');
      if (fn.deepestLine < fn.line || fn.deepestLine > fn.endLine) add(`/functions/${i}/deepestLine`, 'must lie inside the function');
    });
    const pythonCalls = data.repository.language === 'py' && data.callModel === 'python-lexical-v1';
    const sourceTexts = new Map(data.files.map((file) => [file.path, file.sourceText]));
    data.functions?.forEach((fn, i) => {
      if ((pythonCalls || fn.sourceRange) && !validSourceRange(sourceTexts.get(fn.file), fn)) add(`/functions/${i}/sourceRange`, 'must match exact captured definition range and digest');
    });
    const sourceLines = new Map();
    const functionKey = (file, name, line) => JSON.stringify([file, name, line]);
    const functionStarts = new Set((data.functions || []).map((fn) => functionKey(fn.file, fn.name, fn.line)));
    const functionPoints = new Set((data.functions || []).map(fn => JSON.stringify([fn.file, fn.name, fn.sourceRange?.line, fn.sourceRange?.column])));
    const brokenFiles = new Set((data.parse_errors || []).map((error) => error.path));
    const validPoint = (file, point, exclusive = false) => {
      if (!sourceLines.has(file)) sourceLines.set(file, sourceTexts.get(file)?.split(pythonCalls ? /\r\n|[\n\r]/ : /\r\n|[\n\r\u2028\u2029]/));
      const lines = sourceLines.get(file);
      return lines && point.line <= lines.length && point.column <= lines[point.line - 1].length + (exclusive ? 1 : 0);
    };
    const staticImportPairs = new Set(data.imports.filter((edge) => edge.resolved && edge.kind === 'static' && !edge.typeOnly).map((edge) => JSON.stringify([edge.from, edge.to])));
    data.calls.forEach((call, i) => {
      const at = `/calls/${i}`;
      if (!files.has(call.file)) add(`${at}/file`, 'must reference a recorded file');
      else if (!validPoint(call.file, call)) add(at, 'callsite must lie inside captured source');
      if (!validPoint(call.file, { line: call.endLine, column: call.endColumn }, true)) add(at, 'call end must lie inside captured source or at EOF');
      if (call.endLine < call.line || (call.endLine === call.line && call.endColumn <= call.column)) add(at, 'call end must follow its start');
      if (brokenFiles.has(call.file)) add(at, 'calls must be omitted for files with parse errors');
      if (call.target) {
        const targetFile = call.target.file || call.file;
        if (call.resolution === 'imported-function') {
          if (targetFile === call.file || !staticImportPairs.has(JSON.stringify([call.file, targetFile]))) add(`${at}/target/file`, 'must follow a recorded static import to another captured file');
          if (brokenFiles.has(targetFile)) add(`${at}/target`, 'target file must have no parse errors');
        }
        if (!validPoint(targetFile, call.target)) add(`${at}/target`, 'target must lie inside captured source');
        if (pythonCalls && !functionPoints.has(JSON.stringify([targetFile, call.target.name, call.target.line, call.target.column]))) add(`${at}/target`, 'must match a captured Python definition start');
        if (!functionStarts.has(functionKey(targetFile, call.target.name, call.target.line))) add(`${at}/target`, 'target must reference a recorded function in its target file');
      }
    });
    data.parse_errors?.forEach((error, i) => {
      if (!files.has(error.path)) add(`/parse_errors/${i}/path`, 'must reference a recorded file');
    });
  }
  if (name === 'module-graph') {
    const ids = unique(data.modules, 'id', '/modules');
    const pairs = new Set();
    data.edges.forEach((edge, i) => {
      for (const key of ['from', 'to']) if (!ids.has(edge[key])) add(`/edges/${i}/${key}`, 'must reference an existing module');
      if (edge.from === edge.to) add(`/edges/${i}`, 'must connect two distinct modules');
      const pair = JSON.stringify([edge.from, edge.to]);
      if (pairs.has(pair)) add(`/edges/${i}`, 'must be aggregated into one edge per module pair');
      pairs.add(pair);
    });
    if (data.fileModules) {
      const counts = new Map();
      for (const [file, id] of Object.entries(data.fileModules).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
        if (!ids.has(id)) add('/fileModules', 'must reference an existing module', { file, id });
        counts.set(id, (counts.get(id) || 0) + 1);
      }
      data.modules.forEach((m, i) => {
        if ((counts.get(m.id) || 0) !== m.files) add(`/modules/${i}/files`, 'must match fileModules ownership count');
        if (m.entry.some((file) => data.fileModules[file] !== m.id)) add(`/modules/${i}/entry`, 'must belong to this module');
      });
      data.edges.forEach((e, i) => e.evidence.forEach((v, j) => {
        if (data.fileModules[v.file] !== e.from || data.fileModules[v.to] !== e.to) add(`/edges/${i}/evidence/${j}`, 'must agree with fileModules ownership');
      }));
    }
  }
  return errors;
}
