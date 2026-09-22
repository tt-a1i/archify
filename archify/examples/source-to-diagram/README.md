# Source-to-diagram teaching fixture

This example demonstrates a repository-backed architecture authoring pass on a
small CLI transformation project. The source has three responsibilities:
`src/cli.mjs` owns argument parsing and filesystem I/O, `src/options.mjs`
checks that both argument strings are present, and `src/transform.mjs` transforms in-memory text. Input and
output files are filesystem boundaries; they are not mocked remote services.

Materialize a reproducible standalone Git repository from this directory:

```sh
node prepare-fixture.mjs /private/tmp/archify-source-to-diagram-target
```

The preparer refuses to replace an existing destination, neutralizes ambient
Git signing, hooks, templates, config, line-ending, and object-format settings,
sets a fixed commit timestamp and identity, records the credential-free HTTPS
origin, and asserts the canonical SHA. A source drift or different Git result
fails the preparer; the checked-in JSON pins the same SHA.
