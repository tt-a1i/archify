# Original source-first questions: public reading guide

This is a condensed reconstruction of the original question-level documents, written after the studies. Those documents state that the Redux, Commander, pluggy, HTTPX, SLF4J and pandas questions and answers were fixed before their corresponding analyzer runs. The Guava manifest records a pre-analyzer question, but the audit did not independently establish its freeze timestamp. This guide is not a new prospective freeze, and its source answers are not analyzer scores. Later atomic scoring units were selected after prior analyzer exposure; see [FINAL-REPORT.md](FINAL-REPORT.md). Links identify exact historical source, not current releases. Runtime expectations below are the original controls, not claims that this final matrix executed them.

## Redux #4621

**Question:** Which public name became available, where is it implemented, and which existing internal callers changed?

**Expected source answer:** The head adds a default import and named public export of `isPlainObject` in `src/index.ts`; its implementation is `src/utils/isPlainObject.ts`. The three existing internal callers and helper are unchanged; the entry reexports rather than calls the function. Distinguish an import edge and public binding from a behavioral change. Scope is `src/`; this does not establish a released package result.

[Base entry at 85d7f27a0f017c80798207b5e799899078a90ca0](https://github.com/reduxjs/redux/blob/85d7f27a0f017c80798207b5e799899078a90ca0/src/index.ts) · [Head entry at c9e06506f88926e252daf5275495eba0c04bf8e3](https://github.com/reduxjs/redux/blob/c9e06506f88926e252daf5275495eba0c04bf8e3/src/index.ts#L8) · [implementation](https://github.com/reduxjs/redux/blob/c9e06506f88926e252daf5275495eba0c04bf8e3/src/utils/isPlainObject.ts#L5)

## Commander #1763

**Question:** Where is the new hook registered and executed, which command does it receive, and what runs first?

**Expected source answer:** The head stores handlers by event, invokes `preSubcommand` before dispatch to the direct child, and passes the current command and direct subcommand. For a root-to-grandchild invocation, the root hook receives the intermediate child, fires once before the leaf action, and is not forwarded transitively. The base rejects `preSubcommand`. Static call and import edges are separate from binding an arbitrary callback target. The original separate Node control was specified for before/after behavior; it is not an analyzer result.

[Base at 3ae30a291a777ad1f748d86f49903579277f9ea0](https://github.com/tj/commander.js/blob/3ae30a291a777ad1f748d86f49903579277f9ea0/lib/command.js) · [Head registration at 2c7f687eaea6e7b29b917db8d71a06fe6fbfb53e](https://github.com/tj/commander.js/blob/2c7f687eaea6e7b29b917db8d71a06fe6fbfb53e/lib/command.js#L401) · [dispatch](https://github.com/tj/commander.js/blob/2c7f687eaea6e7b29b917db8d71a06fe6fbfb53e/lib/command.js#L1053) · [upstream test](https://github.com/tj/commander.js/blob/2c7f687eaea6e7b29b917db8d71a06fe6fbfb53e/tests/command.hook.test.js#L324)

## pluggy #695

**Question:** What changed in subset hook exclusion, and what must be read outside the patch to understand registration and dispatch?

**Expected source answer:** The parent checks `hasattr(plugin, name)`; the head intersects the excluded plugins with registered hook implementation plugin objects. Registration stores the bound method, `_SubsetHookCaller` filters implementations by plugin object, and normal dispatch invokes the stored function. The latter dispatch modules did not change. The original runtime controls expected an already-registered alias exclusion to return `[keep, alias]` on the parent and `[keep]` on the head; a subset created before later registration instead expected `[]` on the parent and `[late]` on the head. These are bounded controls, not a general callback identity guarantee.

[Base at 2e916c21f3e5b60865d3f1f2d6f0932d61c77707](https://github.com/pytest-dev/pluggy/blob/2e916c21f3e5b60865d3f1f2d6f0932d61c77707/src/pluggy/_manager.py) · [Head at 3d5417a4eff449e17e5bb3e1545b63cbf0e0c768](https://github.com/pytest-dev/pluggy/blob/3d5417a4eff449e17e5bb3e1545b63cbf0e0c768/src/pluggy/_manager.py#L603) · [filter and dispatch](https://github.com/pytest-dev/pluggy/blob/3d5417a4eff449e17e5bb3e1545b63cbf0e0c768/src/pluggy/_hooks.py#L650) · [upstream test](https://github.com/pytest-dev/pluggy/blob/3d5417a4eff449e17e5bb3e1545b63cbf0e0c768/testing/test_pluginmanager.py#L711)

## HTTPX #3377

**Question:** Were `certifi` and `httpcore` removed or deferred, and which constructor/custom-transport paths still load them?

**Expected source answer:** The dependencies remain declared; imports move into selected execution paths. Default `HTTPTransport` construction imports `httpcore` and, absent a supplied SSL context, constructs `SSLContext`, which imports `certifi` even with `verify=False`. `Client._init_transport` returns an explicitly supplied transport before constructing the default transport; that does not guarantee other code avoids imports. Upstream tests were inspected as intent, not executed in this source-only selection.

[Base at eeb5e3c2a3ff2403ec47b5926715ecd61143d92d](https://github.com/encode/httpx/blob/eeb5e3c2a3ff2403ec47b5926715ecd61143d92d/httpx/_config.py) · [Head at e9cabc8e1deb6548c5c5e2f453e343d39a2a5321](https://github.com/encode/httpx/blob/e9cabc8e1deb6548c5c5e2f453e343d39a2a5321/httpx/_config.py#L74) · [transport](https://github.com/encode/httpx/blob/e9cabc8e1deb6548c5c5e2f453e343d39a2a5321/httpx/_transports/default.py#L151) · [dependency declarations](https://github.com/encode/httpx/blob/e9cabc8e1deb6548c5c5e2f453e343d39a2a5321/pyproject.toml#L31)

## SLF4J provider selection

**Question:** How does the change select an explicit provider, and how does that differ from a compile-time interface import?

**Expected source answer:** The head adds the historical `slf4j.binding` class-name property and tries an explicit provider before service discovery, falling back on invalid or missing classes. The source names the service interface; concrete provider modules and service descriptors supply different implementations. The fixed classpath controls expected NOP on both revisions with only the NOP descriptor by default, and Simple on the head but NOP on the parent when the Simple class is explicitly named. Fresh JVMs were specified to avoid static cache effects. These controls do not establish JPMS or Maven reactor behavior; an interface import alone does not identify runtime selection.

[Base at aa13da39edd4195c25eecb1263c4bf3f8902a3e4](https://github.com/qos-ch/slf4j/blob/aa13da39edd4195c25eecb1263c4bf3f8902a3e4/slf4j-api/src/main/java/org/slf4j/LoggerFactory.java) · [Head at 9783320b6c4411a0b120cad9e32cd9a981b1dac2](https://github.com/qos-ch/slf4j/blob/9783320b6c4411a0b120cad9e32cd9a981b1dac2/slf4j-api/src/main/java/org/slf4j/LoggerFactory.java#L182) · [upstream test](https://github.com/qos-ch/slf4j/blob/9783320b6c4411a0b120cad9e32cd9a981b1dac2/slf4j-api/src/test/java/org/slf4j/LoggerFactoryTest.java)

## pandas v2.2.3

**Question:** For an ordinary DataFrame with unique flat columns, why does `df["A"]` return a Series while `df[["A"]]` returns a one-column DataFrame, and what if a label is absent?

**Expected source answer:** A present unique scalar takes the item-cache path and boxes a Series; a list uses strict column indexing and returns a DataFrame without the single-key squeeze. Missing labels raise `KeyError`. Duplicate and MultiIndex columns have distinct paths; the answer does not establish copy/view behavior or general subclass semantics. This question is source interpretation, without pandas execution.

[DataFrame.__getitem__ at 0691c5cf90477d3503834d983f69350f250a6ff7](https://github.com/pandas-dev/pandas/blob/0691c5cf90477d3503834d983f69350f250a6ff7/pandas/core/frame.py#L4062) · [strict indexer](https://github.com/pandas-dev/pandas/blob/0691c5cf90477d3503834d983f69350f250a6ff7/pandas/core/indexes/base.py#L6186)

## Guava Unicode coverage

**Question:** Can imports and method ranges be recovered at their original physical source locations when Java Unicode escapes affect lexical parsing?

**Expected source method and boundary:** Compare original unmodified source against javac parse-only explicit imports and method bodies, including escape eligibility and comment/quote controls; ranges must still slice original text. The original inventory identified seven diagnostic files each in the JRE and Android production trees. This is a single-revision coverage study, not a change pair or a direct-call target oracle. The question's asserted pre-analyzer provenance lacks an independently established freeze timestamp.

[Guava tree at f06690fa3e874f65515e8fd338a74d636e2c792f](https://github.com/google/guava/tree/f06690fa3e874f65515e8fd338a74d636e2c792f/guava/src) · [Java Unicode translation rule](https://docs.oracle.com/javase/specs/jls/se17/html/jls-3.html#jls-3.3)
