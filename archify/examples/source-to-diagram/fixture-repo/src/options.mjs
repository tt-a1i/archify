export function parseArgs(argv) {
	const [input, output] = argv;
	if (!input || !output) throw new Error('usage: line-stamp <input> <output>');
	return {input, output};
}
