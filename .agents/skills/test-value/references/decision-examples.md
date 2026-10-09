# Decision Examples and Common Traps

These examples generalize observed maintenance problems. They are not mandatory solutions or universal thresholds.

## Automatic output and snapshots

**Situation:** a test demands an exact sequence of automatically chosen route coordinates. A shorter valid route fails it.

Separate user-authored ports, positions and paths from algorithm-selected bends. Automatic choices can usually be checked through connectivity, port direction, obstacle avoidance, readability or bounded work; preserve explicit constraints. Verify the assertion against a valid alternative and the original bad route.

Some snapshots remain valuable. Public serialization, protocol bytes, generated-source consistency and promised deterministic output can require exact comparison. Regenerating golden files establishes consistency, not visual quality.

## Shared rule matrices

**Situation:** 22 icons are each rendered through five entrypoints.

If the entrypoints actually share the drawing function and rules, exercise the complete catalog through one real path and retain default, override, hiding and local special cases at each entrypoint. Check schema, preprocessing and layout branches; retain combinations with distinct handling. Identical parameter names do not justify cutting a cross-product.

The same reasoning applies to locales, providers, codecs and runtime versions: distinguish shared rules from real interactions. Disclose combinations no longer traversed rather than claiming identical coverage.

## Source assertions and architecture rules

**Situation:** a test meant to prevent missing release files only searches source code for filenames.

A stronger check untracks or removes required inputs in a temporary repository and observes explicit rejection without output creation. If behavior protection already exists, remove the source assertion without adding a replacement merely to preserve test count.

Static checks can enforce real architectural or safety constraints, such as preventing database imports in a restricted layer or excluding files from a release package. Check dependency relationships or artifact facts rather than import formatting, private names or incidental call counts.

## Failures and shared mistakes

**Situation:** AI-generated implementation and tests agree, but the business result is wrong.

Establish expectations from user examples, compatibility fixtures or an independent calculation. Copying the production algorithm into expected-value generation does not provide an independent oracle. Identify the observable mistake the regression must catch.

**Situation:** a historical test fails.

Compare with the baseline in the same environment to separate existing failures from regressions. Changed requirements call for updated contracts and assertions; product regressions call for implementation fixes; environment failures call for environment repair and visible reporting. A cumbersome test is not, by itself, a reason to ignore its failure.

## Unstable waits and performance

**Situation:** an asynchronous test fails intermittently and turns green on retry.

Prefer real readiness signals and inspect ownership and cleanup. Distinguish a product race from a test timing assumption. Timeouts should reflect the protected deadline and execution environment: an unreasonable test timeout can be widened, while a contractual product deadline still needs coverage. Quarantine needs a reason, replacement protection and a clear restoration condition; it is not a pass.

**Situation:** sharing a browser page or extracted package reduces setup time.

Check storage, globals, timers, network, files and cleanup for isolation. Start rejection cases from clean inputs. Reuse must not conceal leaks when cleanup is part of the behavior under test. A faster case does not establish a faster parallel pipeline.

## Test doubles and test layers

Cheap, controllable tests suit pure rules and fault injection. Packaged relative paths, filesystem casing, browser layout and real process lifecycles need corresponding environments. Preserve necessary integration paths without sending every rule through the UI or public CLI.

Mocked filesystem success does not establish Windows support; skipped Chrome tests do not establish browser acceptance; generated screenshots do not establish readability. Report these as separate claims.

## Implementation and pre-commit review

**Ordinary bug fix:** find existing coverage and extend it with an input reproducing the user's failure. Avoid expanding the task into a test-system redesign.

**Copy-only change or equivalent internal refactor:** reuse existing protection and run affected checks when needed. Do not manufacture string assertions to give every commit a new test.

**Rare output-loss or permission failure:** low frequency does not mean low value. Improve fixtures and scheduling while preserving assertions that distinguish the actual failure.

**Request for faster feedback:** prefer targeted checks and applicable existing evidence. Shortening the local loop does not remove required release checks or authorize committing, pushing or publishing.
