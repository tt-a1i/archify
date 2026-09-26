import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pages = new Set(['index.html', 'gallery.html', 'guide.html', 'start.html']);

export function stagePublic(repo, target) {
  const files = execFileSync('git', ['ls-files', '-z', '--', 'docs/', 'website/public/'], { cwd: repo, encoding: 'utf8' }).split('\0').filter(Boolean);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  for (const file of files) {
    const isDocs = file.startsWith('docs/');
    const relative = file.slice(isDocs ? 'docs/'.length : 'website/public/'.length);
    if (pages.has(relative)) {
      if (!isDocs) throw new Error(`Public asset shadows an Astro page: ${file}`);
      continue;
    }
    // Validate every ancestor too: a tracked directory may have been replaced by a symlink locally.
    let source = repo;
    for (const segment of file.split('/')) {
      source = path.join(source, segment);
      if (fs.lstatSync(source).isSymbolicLink()) throw new Error(`Refusing public asset symlink: ${file}`);
    }
    const output = path.join(target, relative);
    if (fs.existsSync(output)) throw new Error(`Duplicate public URL: ${relative}`);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(source, output);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  stagePublic(path.resolve(root, '..'), path.join(root, '.public'));
  console.log('Staged tracked public URLs; four pages are rendered by Astro.');
}
