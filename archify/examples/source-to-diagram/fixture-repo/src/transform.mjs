export function normalizeLines(text) {
	return text.split(/\r?\n/)
		.map((line, index) => `${String(index + 1).padStart(3, '0')} ${line.trimEnd()}`)
		.join('\n');
}
