import {readFile, writeFile} from 'node:fs/promises';
import {parseArgs} from './options.mjs';
import {normalizeLines} from './transform.mjs';

export async function run(argv) {
	const {input, output} = parseArgs(argv);
	const raw = await readFile(input, 'utf8');
	const normalized = normalizeLines(raw);
	await writeFile(output, normalized + '\n');
	return {input, output};
}

if (import.meta.url === `file://${process.argv[1]}`) await run(process.argv.slice(2));
