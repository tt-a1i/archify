# Sources and permissions

Original fixture, fixed model, diagram and prose: this repository's Apache-2.0
license. These are synthetic data and a specification-derived explanation,
not upstream tool output or a Docker/runtime verification.

Copied unmodified primary references under upstream/ retain their own licenses:

- opencontainers/image-spec, commit
  4feed4a6674e59d301b9294f187ac46acb2de99f: layer.md and complete Apache-2.0
  LICENSE (upstream/image-spec-LICENSE). The source manifest records exact bytes.
- wagoodman/dive, commit d6c691947f8fda635c952a17ee3b7555379d58f0:
  dive/filetree/file_tree.go, file_node.go, file_tree_test.go and complete MIT
  LICENSE (upstream/dive-LICENSE), Copyright (c) 2018 Alex Goodman.

No dive implementation is imported, executed or adapted. Its current tree model
explicitly ignores double-whiteout flags; it is a source-reading comparison, not
the oracle for OCI opaque behavior. No container image, third-party file payload,
Docker runtime, registry client or extractor is bundled.
