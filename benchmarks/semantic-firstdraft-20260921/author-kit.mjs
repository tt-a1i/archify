/**
 * EXPERIMENTAL convenience functions for authoring architecture JSON.
 *
 * This module intentionally does not infer layout, topology, component types,
 * identifiers, labels, or citations. Pass its output through the normal
 * Archify finalize/validation path before treating it as a valid diagram.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const NODE_RESERVED = new Set([
  'id', 'type', 'label', 'sublabel', 'box', 'sourceRefs', 'pos', 'size', 'sources',
]);
const EDGE_RESERVED = new Set(['id', 'from', 'to', 'label']);
const ARCHITECTURE_RESERVED = new Set([
  'schema_version', 'diagram_type', 'meta', 'components', 'connections',
]);
const SOURCE_RANGE = /^([^\r\n:][^\r\n]*):([1-9]\d*)(?:-([1-9]\d*))?$/;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, name) {
  if (!isPlainObject(value)) throw new TypeError(`${name} must be an object`);
}

function assertString(value, name, { optional = false } = {}) {
  if (optional && value === undefined) return;
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function assertJsonValue(value, name, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${name} must contain finite numbers`);
    return;
  }
  if (typeof value !== 'object') throw new TypeError(`${name} must be JSON-serializable`);
  if (!Array.isArray(value) && !isPlainObject(value)) {
    throw new TypeError(`${name} must contain only plain objects`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${name} must not contain symbol-keyed data`);
  }
  if (seen.has(value)) throw new TypeError(`${name} must not contain cycles`);
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) throw new TypeError(`${name} must not contain sparse arrays`);
      assertJsonValue(value[index], `${name}[${index}]`, seen);
    }
  } else {
    for (const [key, child] of Object.entries(value)) {
      assertJsonValue(child, `${name}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function assertExtra(extra, reserved, name) {
  assertPlainObject(extra, name);
  for (const key of Object.keys(extra)) {
    if (reserved.has(key)) throw new TypeError(`${name}.${key} conflicts with a reserved field`);
  }
  assertJsonValue(extra, name);
}

function sourceRef(value, name) {
  if (isPlainObject(value)) {
    assertJsonValue(value, name);
    return value;
  }
  if (typeof value !== 'string') throw new TypeError(`${name} must be a source string or object`);
  const match = SOURCE_RANGE.exec(value);
  if (!match) {
    throw new TypeError(`${name} must use path:line or path:line-end syntax`);
  }
  const line = Number(match[2]);
  const endLine = match[3] === undefined ? undefined : Number(match[3]);
  if (!Number.isSafeInteger(line) || (endLine !== undefined && !Number.isSafeInteger(endLine))) {
    throw new RangeError(`${name} line numbers must be positive safe integers`);
  }
  if (endLine !== undefined && endLine < line) {
    throw new RangeError(`${name} end line must be at least the start line`);
  }
  return endLine === undefined
    ? { path: match[1], line }
    : { path: match[1], line, end_line: endLine };
}

/** Parse an explicit source reference without looking up or enriching it. */
export function ref(value) {
  return sourceRef(value, 'ref');
}

/** Build one explicitly positioned architecture component. */
export function node(id, type, label, sublabel, box, sourceRefs, extra = {}) {
  assertString(id, 'node id');
  assertString(type, 'node type');
  assertString(label, 'node label');
  if (sublabel !== undefined && typeof sublabel !== 'string') {
    throw new TypeError('node sublabel must be a string when provided');
  }
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) {
    throw new TypeError('node box must be [x, y, width, height] finite numbers');
  }
  if (box[2] <= 0 || box[3] <= 0) throw new RangeError('node box width and height must be positive');
  if (sourceRefs !== undefined && !Array.isArray(sourceRefs)) {
    throw new TypeError('node sourceRefs must be an array when provided');
  }
  assertExtra(extra, NODE_RESERVED, 'node extra');

  const component = {
    id,
    type,
    label,
    ...(sublabel === undefined ? {} : { sublabel }),
    pos: [box[0], box[1]],
    size: [box[2], box[3]],
    ...(sourceRefs === undefined ? {} : { sources: sourceRefs.map((value, index) => sourceRef(value, `node sourceRefs[${index}]`)) }),
    ...extra,
  };
  return component;
}

/** Build an authored connection without assigning an id or route on the caller's behalf. */
export function edge(id, from, to, label, extra = {}) {
  assertString(id, 'edge id', { optional: true });
  assertString(from, 'edge from');
  assertString(to, 'edge to');
  if (label !== undefined && typeof label !== 'string') {
    throw new TypeError('edge label must be a string when provided');
  }
  assertExtra(extra, EDGE_RESERVED, 'edge extra');
  return {
    ...(id === undefined ? {} : { id }),
    from,
    to,
    ...(label === undefined ? {} : { label }),
    ...extra,
  };
}

/**
 * Assemble an architecture candidate. `extras` is intentionally passed through
 * (for example boundaries, cards, or future schema fields); meta carries views.
 * Finalize
 * remains the authoritative production validator.
 */
export function architecture(meta, components, connections, extras = {}) {
  assertPlainObject(meta, 'meta');
  assertJsonValue(meta, 'meta');
  if (!Array.isArray(components)) throw new TypeError('components must be an array');
  if (!Array.isArray(connections)) throw new TypeError('connections must be an array');
  assertJsonValue(components, 'components');
  assertJsonValue(connections, 'connections');
  assertExtra(extras, ARCHITECTURE_RESERVED, 'architecture extras');
  const normalizedMeta = Object.hasOwn(meta, 'quality_profile')
    ? { ...meta }
    : { ...meta, quality_profile: 'showcase' };
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: normalizedMeta,
    components,
    ...extras,
    connections,
  };
}

/** Write a normal, pretty JSON candidate, creating its parent directory if needed. */
export async function writeArchitecture(path, spec) {
  assertString(path, 'path');
  assertJsonValue(spec, 'spec');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
}
