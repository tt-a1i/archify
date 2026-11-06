# Public final replay receipt

The committed harness and product were freshly fetched from `https://github.com/tt-a1i/archify.git` at `919dc11f807484754fddcb707fd98fbfb3951c89`. The detached product checkout was clean before and after; the committed ZIP SHA-256 was `2a23e82cc0dce7d10c16955fff6f4bce5d3dc653d0dd40e83f03692ebef3ee0c` before and after. The `archify/` tree and ZIP Git object IDs match the earlier local candidate `749ab83912adbf9617da2926be696f9b45ea90dc` exactly. This is a public-fetch local replay, not CI or a release claim.

The ZIP contains 390 files; 389 match the fetched source byte for byte, including all 155 Code Analysis module files. The only byte difference is `archify/package.json`, whose packaged JSON equals the source after removing `scripts` and `devDependencies`. Java archive verification also checked every extracted member and archive digest before and after execution, permitting dependency files under `node_modules`; it does not authenticate dependency bytes.

**Whole corpus: pass.** The committed replay fetched 12 pinned target checkouts, installed module dependencies separately for source and ZIP with `npm ci --ignore-scripts`, and ran 27 CLI commands per mode. The parity checker passed for 27 command exits/statuses, 12 raw facts, 10 question results, and five paired result files (all five were present). Both adversarial graders passed. The paired contract gate confirmed four ready pairs and the expected partial SLF4J pair; the SLF4J paired command exited 1 as expected for partial coverage, not a fully ready pair.

Per mode, strict scoring recorded 8 correct changed definitions, 8 correct function locations, 7 correct import sites, 4 correct paired outgoing imports, 2 explicitly unknown JavaScript boundary call sites, and 52 Python call sites (4 correct targets, 48 explicit unknowns). Two additional availability cases expanded the contract; they are not target-accuracy successes. These counts concern the frozen selected units, not project-wide accuracy.

**Java selected-method replay: pass.** Freshly fetched SLF4J base `aa13da39edd4195c25eecb1263c4bf3f8902a3e4`, SLF4J head `9783320b6c4411a0b120cad9e32cd9a981b1dac2`, and Guava head `f06690fa3e874f65515e8fd338a74d636e2c792f` supplied the inputs. The runner verified pinned commits, selected source hashes and Java-file cleanliness before and after; the adversarial self-check passed. For eight selected methods, both modes found 86 invocation sites, zero extras, correctly bound and navigated 26 known targets, and explicitly left 60 unknown. These unknowns are outside the bounded target oracle, not evidence that Java has no target. Report and three raw-facts files were byte-identical; all eight questions matched after normalization of only `/workflow` and `/calls/provenance/rawFactsPath`. The frozen oracle SHA-256 was `bc61d7769560713d87314233178db08cc7827aea5e48733d8a5991900eb6e622`.

Environment: macOS arm64, Node 22.23.2, npm 11.20.0, Python 3.13.16, Temurin JDK 17.0.21+9, and `TMPDIR=/private/tmp`. Dependency installation reported 8 npm audit findings (1 moderate, 7 high), not investigated here. The complete logs and raw outputs remain private because they include local paths. No broad test suite was rerun.

Reproduction commands below use placeholders for local paths. The whole-corpus harness performs its own fresh public checkouts. Java uses the three resulting checkout paths; the archive extraction and module installs are separate.

```sh
git init source
git -C source remote add origin https://github.com/tt-a1i/archify.git
git -C source fetch --no-tags --depth=1 origin 919dc11f807484754fddcb707fd98fbfb3951c89
git -C source checkout --detach FETCH_HEAD
SOURCE="$(pwd)/source"
python3.13 source/benchmarks/code-analysis-investigation/replay.py --work "$WORK" --product-sha 919dc11f807484754fddcb707fd98fbfb3951c89 --archive-sha256 2a23e82cc0dce7d10c16955fff6f4bce5d3dc653d0dd40e83f03692ebef3ee0c --require-paired-contract
npm ci --ignore-scripts --prefix source/archify/modules/code-analysis
unzip -q source/archify.zip -d "$JAVA_ARCHIVE"
npm ci --ignore-scripts --prefix "$JAVA_ARCHIVE/archify/modules/code-analysis"
python3.13 source/benchmarks/code-analysis-java-calls/run.py --self-check
python3.13 source/benchmarks/code-analysis-java-calls/run.py --cli "$SOURCE/archify/bin/archify.mjs" --name source --product-sha 919dc11f807484754fddcb707fd98fbfb3951c89 --node "$NODE" --java "$JAVA" --slf4j-base "$WORK/sources/slf4j-base" --slf4j-head "$WORK/sources/slf4j-head" --guava "$WORK/sources/guava-head" --output "$JAVA_SOURCE_RESULTS"
python3.13 source/benchmarks/code-analysis-java-calls/run.py --cli "$JAVA_ARCHIVE/archify/bin/archify.mjs" --name archive --product-sha 919dc11f807484754fddcb707fd98fbfb3951c89 --archive "$SOURCE/archify.zip" --archive-sha 2a23e82cc0dce7d10c16955fff6f4bce5d3dc653d0dd40e83f03692ebef3ee0c --node "$NODE" --java "$JAVA" --slf4j-base "$WORK/sources/slf4j-base" --slf4j-head "$WORK/sources/slf4j-head" --guava "$WORK/sources/guava-head" --output "$JAVA_ARCHIVE_RESULTS"
```

## Comparison with the earlier local final capture

The fresh and prior local source-mode raw facts are byte-identical for eight Python/Java captures. Four JavaScript/TypeScript captures (Redux base/head and Commander base/head) differ in exactly two JSON fields each: `/repository/url` and `/repository/snapshotId`. The prior URL is `null`; the fresh checkout records the public GitHub origin. The extractor reads this value from `git remote get-url origin` and hashes the complete pre-snapshot facts, including the URL, to create `snapshotId`. For all four captures, both stored snapshot hashes were independently recomputed, and substituting the prior null URL into the fresh facts reproduced the prior snapshot hash. Every other JSON value matched. This is an origin/provenance difference, not an observed change to extracted code facts; the snapshot IDs remain distinct and should not be treated as interchangeable. Exact field values, per-capture hashes and counts are in `local-comparison.json`. This comparison is separate from the successful source-versus-ZIP parity within the fresh replay.
