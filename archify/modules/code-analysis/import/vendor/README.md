# External diagnostic input references

`sarif-schema-2.1.0.json` is the unmodified OASIS SARIF 2.1.0 schema (including Errata 01), pinned to [oasis-tcs/sarif-spec 1742a253](https://github.com/oasis-tcs/sarif-spec/blob/1742a253eb654bf8a4ed7c60eaef7412b2c23553/sarif-2.1/schema/sarif-schema-2.1.0.json). The pinned repository's original [license terms](OASIS-LICENSE.md) are preserved verbatim, including its OASIS policies and RF on RAND Terms Mode. Its draft-04 validation runs locally using Ajv; reports cannot load remote schemas or external properties.

`../fingerprints.mjs` adapts only the line-hashing algorithm in [github/codeql-action 592d162b](https://github.com/github/codeql-action/blob/592d162ba3b2f5a3411d2cbf01df9f82c492f269/src/fingerprints.ts), copyright GitHub 2020, under MIT. `CODEQL-LICENSE.txt` preserves that license. The adaptation reads an already captured string synchronously and uses native BigInt modulo 2^64 in place of Long. The upload/logging/runtime code is not included.

Parser organization and field handling were also informed by reviewdog's SARIF parser and DefectDojo's ESLint/Ruff adapters; those runtimes and parser sources are not embedded.
