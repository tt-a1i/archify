# line-stamp CLI fixture

This standalone, dependency-free Node.js CLI reads a text file, normalizes
trailing whitespace while adding line numbers, and writes a new text file.
The CLI owns argument parsing and filesystem I/O; the normalizer only transforms
the in-memory text.
