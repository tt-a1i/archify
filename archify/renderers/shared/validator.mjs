import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemasDir = path.resolve(__dirname, '../../schemas');

const ajv = new Ajv2020({ allErrors: true, strict: false });

const validators = {};
for (const type of ['workflow', 'sequence', 'dataflow', 'lifecycle']) {
  const schema = JSON.parse(fs.readFileSync(path.join(schemasDir, `${type}.schema.json`), 'utf8'));
  validators[type] = ajv.compile(schema);
}

function formatErrors(errors) {
  return errors.map((e) => {
    const where = e.instancePath || '/';
    const detail = e.params && Object.keys(e.params).length
      ? ' ' + JSON.stringify(e.params)
      : '';
    return `  ${where} ${e.message}${detail}`;
  }).join('\n');
}

export function validateSchema(diagramType, data) {
  const validate = validators[diagramType];
  if (!validate) {
    throw new Error(`validateSchema: unknown diagram type "${diagramType}"`);
  }
  if (!validate(data)) {
    throw new Error(
      `${diagramType} schema validation failed:\n${formatErrors(validate.errors)}`
    );
  }
}
