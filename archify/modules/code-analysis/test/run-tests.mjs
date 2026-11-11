import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [major, minor] = process.versions.node.split('.').map(Number);
const args = ['--test'];
if (major > 18 || (major === 18 && minor >= 19)) args.push('--test-concurrency=2');
const files = process.argv.slice(2);
args.push(...(files.length ? files : readdirSync('test').filter(name => name.endsWith('.test.mjs')).sort().map(name => `test/${name}`)));
const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.signal) process.kill(process.pid, result.signal);
process.exitCode = result.status ?? 1;
