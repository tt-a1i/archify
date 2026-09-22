import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateSchema } from './validator.mjs';
import { throwDiagnosticError } from './diagnostics.mjs';

export function byteReceipt(bytes) {
  return { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: Buffer.byteLength(bytes) };
}

function reject(code, message, subject, evidence, supportedFixes) {
  throwDiagnosticError(message, [{ code: `atlas/${code}`, message, subject, evidence, supportedFixes }]);
}

function readJson(filename, subject) {
  try {
    const bytes = fs.readFileSync(filename);
    return { bytes, value: JSON.parse(bytes.toString('utf8')) };
  } catch (error) {
    reject('input', `Cannot read JSON input: ${error.message}`, subject,
      { filename, ...(error.code ? { systemCode: error.code } : { parseError: error.message }) },
      [error instanceof SyntaxError ? `repair JSON syntax in ${filename} and rerun deliver atlas` : `provide a readable JSON file at ${filename} and rerun deliver atlas`]);
  }
}

const key = ({ diagram, node }) => `${diagram}/${node}`;

// No later build stage rereads these source files. Paths remain build-side only.
export function freezeAtlas(input) {
  const inputPath = path.resolve(input);
  const original = readJson(inputPath, { input: inputPath });
  const manifest = original.value;
  validateSchema('atlas', manifest);
  const meta = { locale: 'en', visual_preset: 'classic', ...manifest.meta };
  const members = new Map();
  for (const [id, { source }] of Object.entries(manifest.diagrams)) {
    const subject = { diagram: id, path: `/diagrams/${id}/source` };
    if ((/^[a-z][a-z0-9+.-]*:/i.test(source) && !/^[a-z]:[\\/]/i.test(source)) || source.startsWith('//') || source.includes('\0')) {
      reject('local-source', 'Atlas sources must be local filesystem paths, not URLs or URIs.', subject, { source }, [`replace ${subject.path} with a local relative or absolute filesystem path; do not use a URI`]);
    }
    const sourcePath = path.resolve(path.dirname(inputPath), source);
    const originalMember = readJson(sourcePath, subject);
    const diagram = originalMember.value;
    try {
      validateSchema('architecture', diagram);
    } catch (error) {
      if (error.archifyDiagnostics) {
        error.archifyDiagnostics = error.archifyDiagnostics.map((item) => ({
          ...item, subject: { ...item.subject, diagram: id, source: sourcePath },
        }));
      }
      throw error;
    }
    for (const field of ['locale', 'visual_preset']) {
      if (diagram.meta[field] !== undefined && diagram.meta[field] !== meta[field]) {
        reject('configuration-conflict', `Member ${id} declares ${field} inconsistent with the atlas.`, {
          diagram: id, path: `/meta/${field}`,
        }, { field, actual: diagram.meta[field], expected: meta[field] }, [`remove /meta/${field} from member ${id} to inherit the atlas value, or set it to ${JSON.stringify(meta[field])}`]);
      }
      diagram.meta[field] = meta[field];
    }
    // Authored single-diagram output hints remain part of the validated member
    // contract, but atlas delivery resolves only the manifest-level target.
    const nodes = new Map();
    for (const node of diagram.components) {
      if (nodes.has(node.id)) reject('duplicate-node', `Duplicate node ${node.id} in ${id}.`, { diagram: id, node: node.id }, { actual: node.id, occurrences: diagram.components.filter((item) => item.id === node.id).length }, [`give duplicate /components ids in member ${id} unique values and update connections and atlas endpoints that refer to them`]);
      nodes.set(node.id, node);
    }
    const effectiveBytes = Buffer.from(JSON.stringify(diagram));
    members.set(id, {
      id, sourcePath, sourceBytes: originalMember.bytes, effectiveBytes, diagram, nodes,
      receipts: { source: byteReceipt(originalMember.bytes), effectiveInput: byteReceipt(effectiveBytes) },
    });
  }
  const relations = validateAtlasRelations(manifest, members);
  return {
    inputPath, manifestBytes: original.bytes, manifestReceipt: byteReceipt(original.bytes),
    manifest, meta, members, ...relations,
    inputPaths: [inputPath, ...[...members.values()].map((item) => item.sourcePath)],
  };
}

export function validateAtlasRelations(manifest, members) {
  const details = manifest.details || [];
  const references = manifest.references || [];
  const parent = new Map();
  const detailByNode = new Map();
  const referenceByNode = new Map();
  function member(id, location) {
    if (!members.has(id)) reject('unknown-diagram', `Unknown diagram ${id}.`, { diagram: id, path: location }, { actual: id, available: [...members.keys()] }, [`set ${location} to a declared diagram ID from /diagrams, or add the missing diagram ${id}`]);
    return members.get(id);
  }
  function endpoint(value, location) {
    const node = member(value.diagram, location).nodes.get(value.node);
    if (!node) reject('unknown-node', `Unknown node ${key(value)}.`, { ...value, path: location }, { actual: value.node, available: [...members.get(value.diagram).nodes.keys()] }, [`set ${location}/node to an existing /components/id in diagram ${value.diagram}`]);
    return node;
  }
  member(manifest.entry, '/entry');
  details.forEach((detail, index) => {
    const location = `/details/${index}`;
    endpoint(detail.from, `${location}/from`);
    member(detail.to, `${location}/to`);
    if (detail.to === manifest.entry) reject('root-parent', 'The entry diagram cannot have a parent.', { path: location }, { entry: manifest.entry, detail }, [`remove ${location}; the entry diagram must not be a detail target`]);
    if (detail.to === detail.from.diagram) reject('detail-cycle', 'A diagram cannot contain itself.', { path: location }, { detail }, [`remove ${location} or set ${location}/to to a different non-entry diagram with no parent`]);
    if (parent.has(detail.to)) reject('multiple-parents', `Diagram ${detail.to} has multiple parents.`, { path: location }, { target: detail.to, existingParent: parent.get(detail.to), conflictingParent: detail.from }, [`remove ${location} or the earlier detail targeting ${detail.to} so that it has exactly one parent`]);
    if (detailByNode.has(key(detail.from))) reject('duplicate-detail', 'A node can have only one default detail.', { path: location }, { owner: detail.from, existingDetail: detailByNode.get(key(detail.from)), conflictingDetail: detail.to }, [`remove ${location} or assign it to another component that does not already own a detail`]);
    parent.set(detail.to, detail.from);
    detailByNode.set(key(detail.from), detail.to);
  });
  // Walk the parent forest iteratively: deep valid trees need no recursion limit.
  const rooted = new Set([manifest.entry]);
  for (const id of members.keys()) {
    let cursor = id;
    const visiting = new Set();
    while (!rooted.has(cursor)) {
      if (visiting.has(cursor)) reject('detail-cycle', `Containment cycle at ${cursor}.`, { diagram: cursor }, { cycle: [...visiting].slice([...visiting].indexOf(cursor)).concat(cursor) }, [`replace one detail in the reported cycle with a parent reachable from entry ${manifest.entry}`]);
      visiting.add(cursor);
      if (!parent.has(cursor)) reject('orphan', `Diagram ${cursor} is not reachable from entry.`, { diagram: cursor }, { entry: manifest.entry, disconnected: cursor, parentWalk: [...visiting] }, [`add a detail from a component in the entry tree to ${cursor}, or remove the disconnected diagram and its relations`]);
      cursor = parent.get(cursor).diagram;
    }
    for (const visited of visiting) rooted.add(visited);
  }
  references.forEach((reference, index) => {
    const location = `/references/${index}`;
    const occurrence = endpoint(reference.occurrence, `${location}/occurrence`);
    const target = endpoint(reference.target, `${location}/target`);
    const occurrenceKey = key(reference.occurrence);
    if (occurrence.internal_structure) {
      const componentIndex = members.get(reference.occurrence.diagram).diagram.components.indexOf(occurrence);
      const structurePath = `/components/${componentIndex}/internal_structure`;
      reject('reference-structure', 'A reference occurrence cannot author internal structure; the canonical definition owns it.', {
        ...reference.occurrence, path: structurePath,
      }, { occurrence: reference.occurrence, target: reference.target }, [
        `remove ${structurePath} from ${occurrenceKey} and author the structure only on canonical node ${key(reference.target)}`,
      ]);
    }
    if (occurrenceKey === key(reference.target)) reject('self-reference', 'A reference cannot target itself.', { path: location }, { occurrence: reference.occurrence, target: reference.target }, [`remove ${location} or set its target to a different canonical definition of type ${occurrence.type}`]);
    if (referenceByNode.has(occurrenceKey)) reject('duplicate-reference', 'A reference occurrence must be unique.', { path: location }, { occurrence: reference.occurrence, existingTarget: referenceByNode.get(occurrenceKey), conflictingTarget: reference.target }, [`remove ${location} or the earlier reference for ${occurrenceKey}; retain only one target`]);
    if (occurrence.type !== target.type) reject('reference-type', 'Reference and definition must have the same component type.', { path: location }, { occurrence: reference.occurrence, occurrenceType: occurrence.type, target: reference.target, targetType: target.type }, [`set ${location}/target to a canonical definition of type ${occurrence.type}, or correct the incorrectly authored component type`]);
    if (detailByNode.has(occurrenceKey)) reject('reference-detail', 'A reference occurrence cannot own an internal diagram.', { path: location }, { occurrence: reference.occurrence, ownedDetail: detailByNode.get(occurrenceKey) }, [`remove ${location} to keep this occurrence as a definition, or move its detail to the canonical target`]);
    referenceByNode.set(occurrenceKey, reference.target);
  });
  references.forEach((reference, index) => {
    if (referenceByNode.has(key(reference.target))) {
      reject('reference-chain', 'References must target a definition, not another reference.', { path: `/references/${index}/target` }, { target: reference.target, nextTarget: referenceByNode.get(key(reference.target)) }, [`set /references/${index}/target directly to a canonical definition that does not appear as a reference occurrence`]);
    }
  });
  return { parent };
}
