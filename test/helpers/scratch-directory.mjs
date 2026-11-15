import { after } from 'node:test';
import fs from 'node:fs';

const directories = new Set();
after(() => {
  for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true });
});

// Preserve fixture paths until all assertions finish, including failed cases.
export function createScratchDirectory(prefix) {
  const directory = fs.mkdtempSync(prefix);
  directories.add(directory);
  return directory;
}
