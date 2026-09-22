import {cpSync, existsSync, mkdirSync, rmdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const destination = process.argv[2] && resolve(process.argv[2]);
const EXPECTED_SHA = 'cec633c5019bfa48889691182e69b0e044b48d04';
if (!destination) throw new Error('usage: node prepare-fixture.mjs <empty-destination>');
if (existsSync(destination)) throw new Error(`destination already exists: ${destination}`);

cpSync(resolve(here, 'fixture-repo'), destination, {recursive: true});
const env = {
	...process.env,
	GIT_CONFIG_GLOBAL: '/dev/null',
	GIT_CONFIG_NOSYSTEM: '1',
	GIT_CONFIG_SYSTEM: '/dev/null',
	GIT_AUTHOR_NAME: 'Archify source fixture',
	GIT_AUTHOR_EMAIL: 'fixture@invalid',
	GIT_COMMITTER_NAME: 'Archify source fixture',
	GIT_COMMITTER_EMAIL: 'fixture@invalid',
	GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
	GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
};
for (const key of Object.keys(env)) {
	if (key.startsWith('GIT_CONFIG_') && !['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_SYSTEM'].includes(key)) delete env[key];
	if (['GIT_TEMPLATE_DIR', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES'].includes(key)) delete env[key];
}
const git = args => execFileSync('git', [
	'-c', 'core.autocrlf=false',
	'-c', 'core.safecrlf=false',
	'-c', 'core.hooksPath=/dev/null',
	'-c', 'commit.gpgsign=false',
	...args,
], {cwd: destination, env, encoding: 'utf8'}).trim();
const template = resolve(destination, '.git-template');
mkdirSync(template);
git([`init`, `--template=${template}`, '--object-format=sha1', '-q']);
rmdirSync(template);
git(['config', 'user.name', 'Archify source fixture']);
git(['config', 'user.email', 'fixture@invalid']);
git(['config', 'core.autocrlf', 'false']);
git(['config', 'core.hooksPath', '/dev/null']);
git(['config', 'commit.gpgsign', 'false']);
git(['remote', 'add', 'origin', 'https://fixtures.invalid/archify/line-stamp-cli']);
git(['add', '.']);
git(['commit', '-qm', 'freeze line-stamp CLI fixture']);
const revision = git(['rev-parse', 'HEAD']);
if (EXPECTED_SHA && revision !== EXPECTED_SHA) throw new Error(`unexpected fixture SHA ${revision}; expected ${EXPECTED_SHA}`);
console.log(revision);
