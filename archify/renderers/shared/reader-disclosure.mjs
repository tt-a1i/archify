import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const UPDATE_MANIFEST_URL = 'https://tt-a1i.github.io/archify/skill-updates/archify/stable.json';
const packagePath = fileURLToPath(new URL('../../package.json', import.meta.url));
const packageVersion = JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;

export const readerUpdateSchemaVersion = 1;

// This is the one renderer-neutral interface. It deliberately carries only
// immutable local identity and the project-owned manifest location; browser
// adapters own interaction while the generated file remains offline on load.
export function createReaderUpdateDisclosure({ artifactType, content }) {
  if (typeof artifactType !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(artifactType)) {
    throw new Error(`Invalid reader update artifact type: ${JSON.stringify(artifactType)}`);
  }
  if (typeof content !== 'string') throw new Error('Reader update content must be a string.');
  return {
    schemaVersion: readerUpdateSchemaVersion,
    artifact: {
      type: artifactType,
      generatorVersion: packageVersion,
      // This digests renderer-owned canonical content, avoiding impossible
      // self-referential hashing of the complete generated HTML file.
      contentSha256: createHash('sha256').update(content).digest('hex'),
    },
    update: { manifestUrl: UPDATE_MANIFEST_URL, channel: 'stable' },
  };
}
