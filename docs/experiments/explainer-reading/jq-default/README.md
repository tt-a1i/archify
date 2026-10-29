# jq defaults: source and local probe

This source packet supports the next explainer reading case: why `.enabled // true` returns `true` even for an explicit `false`. No page or human-reading acceptance is claimed yet.

[Probe](probe.py) · [Actual output](probe-output.json) · [Pinned sources](sources.json)

The installed executable is `/usr/bin/jq`, reporting `jq-1.7.1-apple`. Upstream reference is jq 1.7.1, commit `71c2ab509a8628dbbad4bc7b3f98a64aa90d3297`. The Apple version label does not establish binary identity with that upstream commit. The source describes intended upstream behavior; the probe independently records what this local executable produced.

The probe runs 24 constructed cases with exact argv, stdout, stderr and exit status. It reads no user files, changes no configuration and makes no network requests. It checks exact serialized outputs, preserving the distinction between `false` and numeric zero. Two runs produced byte-identical JSON.

- `false`, `null` and no left-hand output trigger the alternative in the individual cases. Zero, an empty string, an empty array and an empty object remain values.
- `empty` produces zero output values; `null` and `[]` each produce one. The empty array is not an empty result stream.
- On the JSON objects in the probe, `.enabled // true` replaces both explicit `false` and `null`, as well as a missing key. Reading a missing object key yields `null`.
- `.enabled | if . == null then true else . end` retains explicit `false` while defaulting null/missing values. `if has("enabled") then .enabled else true end` defaults only a missing key and retains explicit `null` too. These filters return values; they do not edit an input file.
- `(false, null, 0) // "fallback"` produces only `0`. Piping the three values through `. // "fallback"` produces two fallback strings followed by zero. `//` handles the complete left-hand result stream; it is not necessarily a per-element replacement.

The [upstream manual](https://github.com/jqlang/jq/blob/71c2ab509a8628dbbad4bc7b3f98a64aa90d3297/docs/content/manual/v1.7/manual.yml#L2405-L2460) defines the alternative operator. Source links trace the grammar through `gen_definedor` and the false/null branch. The source audit notes one inconsistent sentence in that version's manual; the formal definition, examples, source and local stream pair agree on the behavior described here. No upstream edit or external message was sent.

Run with `python3 docs/experiments/explainer-reading/jq-default/probe.py` from the repository root. A different jq build reports its own version. This is a semantics probe, not a performance benchmark or a claim about all jq versions, other languages, invalid input types or a real configuration workload. No runtime source change, package rebuild or installation is involved.
