// Real tsserver protocol and Compiler API peers for adapter projections.
// No analyzed module is executed; automatic type acquisition is disabled.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const require = createRequire(import.meta.url);
export const sdkPath = process.env.ARCHIFY_TEST_TYPESCRIPT_SDK || path.dirname(require.resolve('typescript/package.json'));
export const ts = require(sdkPath);
export function officialFixture(t, observation) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-ts-official-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  for (const [relative, contents] of Object.entries(observation.files)) {
    const file = path.join(workspace, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof contents === 'string' || Buffer.isBuffer(contents) ? contents : JSON.stringify(contents));
  }
  const root = path.join(workspace, observation.root || '.');
  const selected = Object.keys(observation.files).map(file => path.relative(root, path.join(workspace, file)).split(path.sep).join('/'))
    .filter(file => file !== '..' && !file.startsWith('../') && !file.includes('node_modules/') && /\.(?:[mc]?[jt]s|[jt]sx)$/.test(file));
  return { root, selected };
}

export const inferredOptions = {
  module: 'Preserve', moduleResolution: 'Bundler', target: 'ES2022',
  jsx: 'react-jsx', allowImportingTsExtensions: true, allowJs: true,
};

export async function serverProjects(root, entries, sdk = sdkPath) {
  const requests = [{ seq: 1, type: 'request', command: 'compilerOptionsForInferredProjects',
    arguments: { options: inferredOptions } }];
  const infoRequests = [];
  for (const entry of entries) {
    const file = path.join(root, entry);
    requests.push({ seq: requests.length + 1, type: 'request', command: 'open', arguments: { file, projectRootPath: root } });
  }
  for (const entry of entries) {
    const file = path.join(root, entry);
    const seq = requests.length + 1;
    requests.push({ seq, type: 'request', command: 'projectInfo', arguments: { file, needFileNameList: true } });
    infoRequests.push([entry, seq]);
  }
  const child = spawn(process.execPath, [path.join(sdk, 'lib/tsserver.js'), '--disableAutomaticTypingAcquisition', '--useInferredProjectPerProjectRoot']);
  const responses = [];
  let stderr = '', stopped = false;
  const lines = createInterface({ input: child.stdout });
  const completed = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    lines.on('line', line => {
      if (!line.startsWith('{')) return;
      const message = JSON.parse(line);
      responses.push(message);
      if (!stopped && infoRequests.every(([, seq]) => responses.some(item => item.type === 'response' && item.request_seq === seq))) {
        stopped = true;
        child.stdin.end(`${JSON.stringify({ seq: requests.length + 1, type: 'request', command: 'exit' })}\n`);
      }
    });
    child.on('close', code => { lines.close(); code === 0 ? resolve() : reject(new Error(`tsserver exited ${code}: ${stderr}`)); });
  });
  const timeout = setTimeout(() => child.kill(), 30000);
  try {
    child.stdin.write(`${requests.map(request => JSON.stringify(request)).join('\n')}\n`);
    await completed;
  } finally { clearTimeout(timeout); }
  return new Map(infoRequests.map(([entry, seq]) => {
    const response = responses.find(item => item.type === 'response' && item.request_seq === seq);
    assert.equal(response?.success, true, JSON.stringify(response || { responses, stderr }));
    const config = response.body.configFileName;
    const relative = file => path.relative(root, file).split(path.sep).join('/');
    return [entry, { config: config.includes('/dev/null/') || config.startsWith('/dev/null/') ? null : relative(config),
      files: response.body.fileNames.map(relative).filter(file => file !== '..' && !file.startsWith('../') && !file.includes('node_modules/') && /\.(?:[mc]?[jt]s|[jt]sx)$/.test(file)).sort() }];
  }));
}

export function configuredProgram(root, configName) {
  if (!configName) {
    const converted = ts.convertCompilerOptionsFromJson(inferredOptions, root);
    assert.deepEqual(converted.errors, []);
    return { options: converted.options, roots: [] };
  }
  const file = path.join(root, configName);
  const loaded = ts.readConfigFile(file, ts.sys.readFile);
  assert.equal(loaded.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, path.dirname(file), undefined, file);
  assert.deepEqual(parsed.errors.filter(error => error.code !== 18003), []);
  return { options: parsed.options, roots: parsed.fileNames };
}
