import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'schemas');
const ajv = new Ajv2020({ allErrors: true, strict: true });
const cache = new Map();

export function validator(name) {
  if (!cache.has(name)) {
    const schema = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, `${name}.schema.json`), 'utf8'));
    cache.set(name, ajv.compile(schema));
  }
  return cache.get(name);
}

// Returns [] when valid, otherwise ajv error objects reduced to stable fields.
export function schemaErrors(name, data) {
  const validate = validator(name);
  if (validate(data)) return [];
  return validate.errors.map((e) => ({ path: e.instancePath || '/', message: e.message, params: e.params }));
}
