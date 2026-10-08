// Rules repairer: turns diagnostics into document edits using only what the
// receipt carries (subject paths, evidence, supportedFixes, px figures in
// messages). Diagnostics that do not map to an edit are reported as
// unactionable; the repairer never inspects the injection record.

const MISSING_VALUE_HINTS = {
  output: 'output.html',
  title: 'Untitled diagram',
};

function unescapePointer(part) {
  return part.replace(/~1/g, '/').replace(/~0/g, '~');
}

export function getByPointer(doc, pointer) {
  let target = doc;
  for (const part of pointer.split('/').filter(Boolean).map(unescapePointer)) {
    if (target === undefined || target === null) return undefined;
    target = target[part];
  }
  return target;
}

export function setByPointer(doc, pointer, value) {
  const parts = pointer.split('/').filter(Boolean).map(unescapePointer);
  let target = doc;
  for (const part of parts.slice(0, -1)) {
    if (target === undefined || target === null) return false;
    target = target[part];
  }
  if (target === undefined || target === null) return false;
  target[parts[parts.length - 1]] = value;
  return true;
}

function uniqueId(doc, base, collection) {
  const used = new Set((doc[collection] || []).map((node) => node.id));
  let index = 2;
  let candidate = `${base}-${index}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `${base}-${index}`;
  }
  return candidate;
}

const RULES = [
  {
    match: (diagnostic) => diagnostic.code === 'schema/required'
      && diagnostic.subject?.path && diagnostic.evidence?.missingProperty,
    apply(diagnostic, doc) {
      const property = diagnostic.evidence.missingProperty;
      const value = MISSING_VALUE_HINTS[property];
      if (value === undefined) return null;
      const pointer = `${diagnostic.subject.path === '/' ? '' : diagnostic.subject.path}/${property}`;
      return setByPointer(doc, pointer, value)
        ? { detail: `set ${pointer} to ${JSON.stringify(value)}` }
        : null;
    },
  },
  {
    match: (diagnostic) => ['schema/enum', 'schema/const'].includes(diagnostic.code)
      && diagnostic.subject?.path
      && (diagnostic.evidence?.allowedValues?.length || diagnostic.evidence?.allowedValue !== undefined),
    apply(diagnostic, doc) {
      const value = diagnostic.evidence.allowedValues?.[0] ?? diagnostic.evidence.allowedValue;
      return setByPointer(doc, diagnostic.subject.path, value)
        ? { detail: `set ${diagnostic.subject.path} to ${JSON.stringify(value)}` }
        : null;
    },
  },
  {
    match: (diagnostic) => diagnostic.code === 'schema/additionalProperties'
      && diagnostic.subject?.path && diagnostic.evidence?.additionalProperty,
    apply(diagnostic, doc) {
      const pointer = `${diagnostic.subject.path === '/' ? '' : diagnostic.subject.path}/${diagnostic.evidence.additionalProperty}`;
      const parts = pointer.split('/').filter(Boolean).map(unescapePointer);
      let target = doc;
      for (const part of parts.slice(0, -1)) target = target?.[part];
      if (target === undefined || target === null) return null;
      delete target[parts[parts.length - 1]];
      return { detail: `removed ${pointer}` };
    },
  },
  {
    // "Label "X" (~475px) is wider than component "users" (120px)"
    match: (diagnostic) => diagnostic.code === 'layout/constraint'
      && /Label "(.+)" \(~[\d.]+px\) is wider than component "([^"]+)" \(([\d.]+)px\)/.test(diagnostic.message || ''),
    apply(diagnostic, doc, context) {
      const match = diagnostic.message.match(/Label "(.+)" \(~([\d.]+)px\) is wider than component "([^"]+)" \(([\d.]+)px\)/);
      const [, label, labelPx, nodeId, widthPx] = match;
      const nodes = doc[context.nodes] || [];
      const node = nodes.find((entry) => entry.id === nodeId || entry.label === label);
      if (!node) return null;
      const pxPerChar = Number(labelPx) / Math.max(label.length, 1);
      const maxChars = Math.max(1, Math.floor(Number(widthPx) / pxPerChar));
      if (label.length <= maxChars) return null;
      node.label = label.slice(0, maxChars);
      return { detail: `shortened label of "${node.id}" to ${maxChars} chars` };
    },
  },
  {
    match: (diagnostic) => diagnostic.code === 'workflow/duplicate-node-id'
      && diagnostic.evidence?.duplicatePath && diagnostic.evidence?.duplicateNodeId,
    apply(diagnostic, doc, context) {
      const pointer = diagnostic.evidence.duplicatePath;
      const id = uniqueId(doc, diagnostic.evidence.duplicateNodeId, context.nodes);
      return setByPointer(doc, pointer, id)
        ? { detail: `renamed duplicate node at ${pointer} to "${id}"` }
        : null;
    },
  },
  {
    // "set /edges/0/to to verified node id "chat""
    match: (diagnostic) => /\/unknown-(edge-)?endpoint$/.test(diagnostic.code || '')
      && diagnostic.subject?.path
      && diagnostic.supportedFixes?.some((fix) => /set \S+ to verified node id "/.test(fix)),
    apply(diagnostic, doc) {
      const fixes = (diagnostic.supportedFixes || [])
        .map((entry) => entry.match(/set (\S+) to verified node id "([^"]+)"/))
        .filter(Boolean);
      const candidate = fixes.filter((fix) => fix[2] === fixes[0]?.[2]);
      if (!candidate.length || candidate.some((fix) => getByPointer(doc, fix[1]) === undefined)) return null;
      const applied = [];
      for (const fix of candidate) {
        if (!setByPointer(doc, fix[1], fix[2])) return null;
        applied.push(fix[1]);
      }
      return { detail: `set ${applied.join(', ')} to "${candidate[0][2]}"` };
    },
  },
  {
    // "set meta.output to a portable relative .html path such as reports/diagram.html"
    match: (diagnostic) => (diagnostic.code || '').startsWith('output/meta-')
      && diagnostic.subject?.path === '/meta/output',
    apply(diagnostic, doc) {
      const fix = (diagnostic.supportedFixes || [])
        .find((entry) => /such as (\S+\.html)/.test(entry));
      const value = fix ? fix.match(/such as (\S+\.html)/)[1] : 'output.html';
      return setByPointer(doc, '/meta/output', value)
        ? { detail: `set /meta/output to ${JSON.stringify(value)}` }
        : null;
    },
  },
  {
    // "...reflow automatic spacing ... so the complete viewBox width is at most
    // 1240px (current 2400px; ...)"
    match: (diagnostic) => diagnostic.code === 'composition/desktop-readability'
      && diagnostic.supportedFixes?.some((fix) => /at most (\d+(?:\.\d+)?)px \(current ([\d.]+)px/.test(fix)),
    apply(diagnostic, doc) {
      const fix = diagnostic.supportedFixes.find((entry) => /at most [\d.]+px \(current [\d.]+px/.test(entry));
      const width = Number(fix.match(/at most (\d+(?:\.\d+)?)px \(current [\d.]+px/)[1]);
      const viewBox = getByPointer(doc, '/meta/viewBox');
      if (!Array.isArray(viewBox) || viewBox.length < 2) return null;
      if (viewBox.length === 2) doc.meta.viewBox = [Math.floor(width), viewBox[1]];
      else doc.meta.viewBox = [viewBox[0], viewBox[1], Math.floor(width), viewBox[3]];
      return { detail: `set meta.viewBox width to ${Math.floor(width)}` };
    },
  },
];

export function repairFromDiagnostics(doc, diagnostics, { type, nodes }) {
  const context = { type, nodes };
  const applied = [];
  const unactionable = [];
  for (const diagnostic of diagnostics || []) {
    const rule = RULES.find((candidate) => candidate.match(diagnostic));
    let action = null;
    if (rule) {
      try {
        action = rule.apply(diagnostic, doc, context);
      } catch {
        action = null;
      }
    }
    if (action) applied.push({ code: diagnostic.code, ...action });
    else unactionable.push({ code: diagnostic.code, message: diagnostic.message });
  }
  return { applied, unactionable };
}
