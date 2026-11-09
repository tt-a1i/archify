import { rangeText, validSourceRange } from './source-range.mjs';
import { createHash } from 'node:crypto';
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
    const pythonCalls = data.repository.language === 'py' && ['python-lexical-v1', 'python-lexical-v2'].includes(data.callModel);
    const javaCalls = data.repository.language === 'java' && ['java-static-lexical-v1', 'java-static-lexical-v2', 'java-static-lexical-v3', 'java-static-lexical-v4', 'java-static-lexical-v5'].includes(data.callModel);
    const goCalls = data.repository.language === 'go' && ['go-source-direct-v1', 'go-source-direct-v2', 'go-source-direct-v3', 'go-source-direct-v4'].includes(data.callModel);
    if (goCalls && ['go-source-direct-v3', 'go-source-direct-v4'].includes(data.callModel) && !data.languageScope?.standardLibrary) add('/languageScope/standardLibrary', 'requires recorded Go v3 SDK scope');
    const rustCalls = data.repository.language === 'rust' && ['rust-source-direct-v1', 'rust-source-direct-v2', 'rust-source-direct-v3', 'rust-source-direct-v4', 'rust-source-direct-v5', 'rust-source-direct-v6', 'rust-source-direct-v7', 'rust-source-direct-v8', 'rust-source-direct-v9', 'rust-source-direct-v10', 'rust-source-direct-v11', 'rust-source-direct-v12'].includes(data.callModel);
    const sourceTexts = new Map(data.files.map((file) => [file.path, file.sourceText]));
    const javaProjects = javaCalls && data.callModel === 'java-static-lexical-v5';
    if (javaProjects && data.languageScope?.language !== 'java') add('/languageScope','requires Java v5 declared project scope');
    if (javaProjects) unique(data.languageScope?.metadata || [],'file','/languageScope/metadata');
    const metadata = new Map(javaProjects ? (data.languageScope?.metadata || []).map(input => [input.file,input]) : []);
    for (const input of metadata.values()) {
      if (files.has(input.file) || createHash('sha256').update(input.sourceText).digest('hex') !== input.sha256) add('/languageScope/metadata','must contain separate captured metadata with matching hashes');
    }

    data.functions?.forEach((fn, i) => {
      if ((pythonCalls || javaCalls || goCalls || rustCalls || fn.sourceRange) && !validSourceRange(sourceTexts.get(fn.file), fn, data.repository.language)) add(`/functions/${i}/sourceRange`, 'must match exact captured definition range and digest');
      if (fn.definition) {
        const { kind, sourceRange: range } = fn.definition;
        const python = ['FunctionDef', 'AsyncFunctionDef'].includes(kind);
        const slice = rangeText(sourceTexts.get(fn.file), range, data.repository.language);
        if (slice === null || createHash('sha256').update(slice).digest('hex') !== range.sha256
          || range.line > fn.line || range.endLine !== fn.endLine
          || (python ? data.repository.language !== 'py' : kind === 'FuncDecl' || kind === 'InterfaceMethod' ? data.repository.language !== 'go' : kind === 'RustItemFn' ? data.repository.language !== 'rust' : data.repository.language !== 'java')
          || (fn.sourceRange && (range.line > fn.sourceRange.line || (range.line === fn.sourceRange.line && range.column > fn.sourceRange.column)
            || range.endLine !== fn.sourceRange.endLine || range.endColumn !== fn.sourceRange.endColumn))) {
          add(`/functions/${i}/definition/sourceRange`, 'must match exact captured owned definition extent and digest');
        }
      }
    });
    if (javaProjects) for (const input of metadata.values()) sourceTexts.set(input.file,input.sourceText);
    const sourceLines = new Map();
    const functionKey = (file, name, line) => JSON.stringify([file, name, line]);
    const functionStarts = new Set((data.functions || []).map((fn) => functionKey(fn.file, fn.name, fn.line)));
    const functionPoints = new Set((data.functions || []).map(fn => JSON.stringify([fn.file, fn.name, fn.sourceRange?.line, fn.sourceRange?.column])));
    const traitDeclarations = new Set();
    for (const [i, decl] of (data.traits || []).entries()) {
      const point = decl.declaration;
      if (!point || !files.has(point.file) || !(Number.isInteger(point.line) && point.line >= 1 && Number.isInteger(point.column) && point.column >= 1)) add(`/traits/${i}/declaration`, 'must reference a valid captured declaration point');
      for (const [j, method] of (decl.methods || []).entries()) {
        if (!files.has(method.file) || !(Number.isInteger(method.line) && method.line >= 1 && Number.isInteger(method.column) && method.column >= 1)) add(`/traits/${i}/methods/${j}`, 'must reference a valid captured declaration point');
        traitDeclarations.add(JSON.stringify([method.file, method.name, method.line, method.column]));
      }
    }
    for (const [i, edge] of (data.traitImplementations || []).entries()) {
      for (const part of ['trait', 'traitMethod', 'implementation']) {
        const point = edge[part];
        if (!point || !files.has(point.file) || !(Number.isInteger(point.line) && point.line >= 1 && Number.isInteger(point.column) && point.column >= 1)) add(`/traitImplementations/${i}/${part}`, 'must reference a valid captured declaration point');
      }
      if (edge.traitMethod) traitDeclarations.add(JSON.stringify([edge.traitMethod.file, edge.traitMethod.name, edge.traitMethod.line, edge.traitMethod.column]));
    }
    const brokenFiles = new Set((data.parse_errors || []).map((error) => error.path));
    const validPoint = (file, point, exclusive = false) => {
      if (!sourceLines.has(file)) sourceLines.set(file, sourceTexts.get(file)?.split(goCalls || rustCalls ? /\n/ : pythonCalls ? /\r\n|[\n\r]/ : /\r\n|[\n\r\u2028\u2029]/));
      const lines = sourceLines.get(file);
      return lines && point.line <= lines.length && point.column <= lines[point.line - 1].length + (exclusive ? 1 : 0);
    };
    const staticImports = new Map();
    for (const edge of data.imports) if (edge.resolved && edge.kind === 'static' && !edge.typeOnly) {
      if (!staticImports.has(edge.from)) staticImports.set(edge.from, new Set());
      staticImports.get(edge.from).add(edge.to);
    }
    const forwardingModel = data.repository.language === 'ts' && /^typescript@/.test(data.repository.adapter) && data.callModel === 'js-ts-lexical-v5';
    const valueImportLines = forwardingModel ? new Set(data.imports.filter(edge => edge.resolved && ['static', 'export'].includes(edge.kind) && !edge.typeOnly).map(edge => JSON.stringify([edge.from, edge.line, edge.to]))) : null;
    data.calls.forEach((call, i) => {
      const at = `/calls/${i}`;
      if (!files.has(call.file)) add(`${at}/file`, 'must reference a recorded file');
      else if (!validPoint(call.file, call)) add(at, 'callsite must lie inside captured source');
      if (!validPoint(call.file, { line: call.endLine, column: call.endColumn }, true)) add(at, 'call end must lie inside captured source or at EOF');
      if (call.endLine < call.line || (call.endLine === call.line && call.endColumn <= call.column)) add(at, 'call end must follow its start');
      if (brokenFiles.has(call.file)) add(at, 'calls must be omitted for files with parse errors');
      if (call.defaultMethod) {
        const method = call.defaultMethod;
        if (!rustCalls || !['rust-source-direct-v6', 'rust-source-direct-v7', 'rust-source-direct-v8', 'rust-source-direct-v9', 'rust-source-direct-v10', 'rust-source-direct-v11', 'rust-source-direct-v12'].includes(data.callModel)) add(`${at}/defaultMethod`, 'requires the Rust v6+ trait default-body model');
        else if (!files.has(method.file) || brokenFiles.has(method.file) || !validPoint(method.file, method)
          || !traitDeclarations.has(JSON.stringify([method.file, method.name, method.line, method.column]))) add(`${at}/defaultMethod`, 'must match a captured trait method declaration');
      }
      if (call.macroTemplate) {
        const { definition, expansions } = call.macroTemplate;
        if (!rustCalls || data.callModel !== 'rust-source-direct-v12') add(`${at}/macroTemplate`, 'requires the Rust v12 impl-body macro provenance model');
        if (!files.has(definition.file) || brokenFiles.has(definition.file) || !validPoint(definition.file, definition)) add(`${at}/macroTemplate/definition`, 'must reference a valid captured macro definition point');
        const origins = new Set();
        for (const [j, expansion] of expansions.entries()) {
          const origin = JSON.stringify([expansion.file, expansion.line, expansion.column, expansion.implLine, expansion.implColumn]);
          if (origins.has(origin)) add(`${at}/macroTemplate/expansions/${j}`, 'must contain distinct expansion origins');
          origins.add(origin);
          if (!files.has(expansion.file) || brokenFiles.has(expansion.file) || !validPoint(expansion.file, expansion)
            || !validPoint(expansion.file, { line: expansion.implLine, column: expansion.implColumn })) add(`${at}/macroTemplate/expansions/${j}`, 'must reference valid captured invocation and impl points');
        }
      }
      if (call.directCaller?.kind === 'macro-generated-method' && (!rustCalls || !['rust-source-direct-v11', 'rust-source-direct-v12'].includes(data.callModel))) add(`${at}/directCaller/kind`, 'requires the Rust v11+ impl-body macro model');
      if (call.reason === 'java-inherited-build-scope' && (!javaCalls || !['java-static-lexical-v4','java-static-lexical-v5'].includes(data.callModel))) add(at + '/reason', 'requires the Java v4 inherited-context model');
      if (call.buildEvidence) {
        if (!javaProjects || call.resolution !== 'java-qualified-static-method') add(at + '/buildEvidence','requires a qualified Java v5 project-source candidate');
        for (const point of call.buildEvidence) if (!metadata.has(point.file) || !validPoint(point.file,point)) add(at + '/buildEvidence','must reference a captured POM source point');
      }
      if (call.qualifierAncestry) {
        if (!javaCalls || !['java-static-lexical-v4','java-static-lexical-v5'].includes(data.callModel) || call.resolution !== 'java-qualified-static-method') add(at + '/qualifierAncestry', 'requires a qualified call under Java v4');
        const points = new Set();
        for (const point of call.qualifierAncestry) {
          const key = JSON.stringify(point);
          if (points.has(key) || !files.has(point.file) || brokenFiles.has(point.file) || !validPoint(point.file, point)) add(at + '/qualifierAncestry', 'must contain distinct valid captured ancestor points');
          points.add(key);
        }
      }
      if (call.via && (!forwardingModel || call.resolution !== 'imported-function')) add(`${at}/via`, 'requires an imported call under the JS/TS v5 forwarding model');
      if (call.target) {
        const targetFile = call.target.file || call.file;
        if (call.resolution === 'java-qualified-static-method' && (!javaCalls || !['java-static-lexical-v2', 'java-static-lexical-v3', 'java-static-lexical-v4', 'java-static-lexical-v5'].includes(data.callModel))) add(`${at}/resolution`, 'requires the Java v2 source model');
        if (call.resolution === 'imported-function') {
          const direct = staticImports.get(call.file)?.has(targetFile);
          let forwarded = pythonCalls && data.callModel === 'python-lexical-v2' && [...(staticImports.get(call.file) || [])].some(via => !brokenFiles.has(via) && staticImports.get(via)?.has(targetFile));
          if (call.via && forwardingModel) {
            const route = [call.file, ...call.via.map(point => point.file), targetFile];
            forwarded = new Set(route).size === route.length && staticImports.get(call.file)?.has(route[1]);
            for (const [index, point] of call.via.entries()) {
              if (!files.has(point.file) || brokenFiles.has(point.file) || !validPoint(point.file, point)
                || !valueImportLines.has(JSON.stringify([point.file, point.line, route[index + 2]]))) forwarded = false;
            }
            if (!forwarded) add(`${at}/via`, 'must follow an acyclic recorded value import/export path at captured source points');
          }
          if (targetFile === call.file || (!direct && !forwarded)) add(`${at}/target/file`, 'must follow a recorded static import or supported reexport to another captured file');
          if (brokenFiles.has(targetFile)) add(`${at}/target`, 'target file must have no parse errors');
        }
        if (call.resolution === 'rust-inherent-source-candidate' && (!rustCalls || !['rust-source-direct-v2', 'rust-source-direct-v3', 'rust-source-direct-v4', 'rust-source-direct-v5', 'rust-source-direct-v6', 'rust-source-direct-v7', 'rust-source-direct-v8', 'rust-source-direct-v9', 'rust-source-direct-v10', 'rust-source-direct-v11', 'rust-source-direct-v12'].includes(data.callModel))) add(`${at}/resolution`, 'requires the Rust v2 inherent source-candidate model');
        if (call.resolution === 'rust-specialized-inherent-source-candidate' && (!rustCalls || !['rust-source-direct-v3', 'rust-source-direct-v4', 'rust-source-direct-v5', 'rust-source-direct-v6', 'rust-source-direct-v7', 'rust-source-direct-v8', 'rust-source-direct-v9', 'rust-source-direct-v10', 'rust-source-direct-v11', 'rust-source-direct-v12'].includes(data.callModel))) add(`${at}/resolution`, 'requires the Rust v3 concrete-specialization source-candidate model');
        if (call.resolution === 'rust-lifetime-inherent-source-candidate' && (!rustCalls || !['rust-source-direct-v4', 'rust-source-direct-v5', 'rust-source-direct-v6', 'rust-source-direct-v7', 'rust-source-direct-v8', 'rust-source-direct-v9', 'rust-source-direct-v10', 'rust-source-direct-v11', 'rust-source-direct-v12'].includes(data.callModel))) add(`${at}/resolution`, 'requires the Rust v4 lifetime-only inherent source-candidate model');
        if (call.resolution === 'rust-direct-function' && !rustCalls) add(`${at}/resolution`, 'requires the Rust source-direct model');
        if (call.resolution === 'rust-trait-impl' && (!rustCalls || !['rust-source-direct-v5', 'rust-source-direct-v6', 'rust-source-direct-v7', 'rust-source-direct-v8', 'rust-source-direct-v9', 'rust-source-direct-v10', 'rust-source-direct-v11', 'rust-source-direct-v12'].includes(data.callModel))) add(`${at}/resolution`, 'requires the Rust v5 trait impl model');
        if (call.resolution === 'rust-trait-method-candidate' && (!rustCalls || !['rust-source-direct-v5', 'rust-source-direct-v6', 'rust-source-direct-v7', 'rust-source-direct-v8', 'rust-source-direct-v9', 'rust-source-direct-v10', 'rust-source-direct-v11', 'rust-source-direct-v12'].includes(data.callModel))) add(`${at}/resolution`, 'requires the Rust v5 trait candidate model');
        if (call.resolution === 'rust-trait-method-candidate' && !traitDeclarations.has(JSON.stringify([targetFile, call.target.name, call.target.line, call.target.column]))) add(`${at}/target`, 'must match a captured trait method declaration');
        if (call.resolution === 'go-direct-method' && (!goCalls || !['go-source-direct-v2', 'go-source-direct-v3', 'go-source-direct-v4'].includes(data.callModel))) add(`${at}/resolution`, 'requires the Go v2 concrete-method model');
        if (call.resolution === 'go-interface-method' && (!goCalls || !['go-source-direct-v3', 'go-source-direct-v4'].includes(data.callModel))) add(`${at}/resolution`, 'requires the Go v3 interface-declaration model');
        if (call.resolution === 'go-direct-function' && !goCalls) add(`${at}/resolution`, 'requires the Go source-direct model');
        if (!validPoint(targetFile, call.target)) add(`${at}/target`, 'target must lie inside captured source');
        if (call.resolution !== 'rust-trait-method-candidate') {
          if ((pythonCalls || javaCalls || goCalls || rustCalls) && !functionPoints.has(JSON.stringify([targetFile, call.target.name, call.target.line, call.target.column]))) add(`${at}/target`, 'must match a captured definition start');
          if (!functionStarts.has(functionKey(targetFile, call.target.name, call.target.line))) add(`${at}/target`, 'target must reference a recorded function in its target file');
        }
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
