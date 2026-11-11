// Keep release/registry checks from silently selecting a different input root.
export function checkerOption(argv, name, fallback = null) {
  let value;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== name) continue;
    const candidate = argv[index + 1];
    if (!candidate || candidate.startsWith('--')) throw new Error(`${name} requires a value.`);
    value ??= candidate;
  }
  return value ?? fallback;
}
