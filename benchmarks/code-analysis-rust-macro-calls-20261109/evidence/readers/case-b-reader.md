# Uninvolved reader check: clap case B

The reader was a fresh agent with no access to this benchmark. It received only:

- base checkout `/tmp/clap-c2-base`, head `/tmp/clap-c2-head`;
- entry `clap_builder/src/parser/parser.rs`;
- the question `"What changed?"`;
- the CLI invocation;
- an instruction not to read this benchmark directory or any frozen answer.

It reported (abridged, verbatim coordinates):

> Changed definitions: `Parser<'cmd>::is_new_arg` head 635:5–665:6 and
> `Parser<'cmd>::parse_short_arg` head 831:5–965:6. The real edits rename
> `is_number()` to `is_negative_number()` at 646, 844 and 854.
>
> Callers of `parse_short_arg`: exactly one, `parser.rs:185:44–191:22`, direct
> caller `get_matches_with` (49:5), resolution `rust-inherent-source-candidate`,
> target `parser.rs:831:5`, navigation `valid`.
>
> Wrapping evidence: `macroEvidence: [{name:"ok",
> definition:"clap_builder/src/macros.rs:554:14", argumentUse:"once",
> expansion:"preserved"}]`. Confirmed in source: line 185 is
> `let parse_result = ok!(self.parse_short_arg(...));` and macros.rs:554 is
> `macro_rules! ok` with one `$expr:expr` used once.
>
> `is_new_arg` has one caller at `331:29–331:53`, target 635:5, `valid`, no
> macroEvidence — confirmed.
>
> It also noted 53 unresolved calls in `parse_short_arg`'s range (22 method
> dispatch, 10 macro-not-expanded, 8 no-local-binding), including the changed
> call site inside `matches!` at 844, so that individual edit is not bound.
>
> Trust: high for the changed-definition set and the single verified call site;
> limited for behavioral impact because the renamed `clap_lex` API is outside
> what the tool verified.

Score against `answers/real-changes.md`: **correct**. The reader found the same
changed definitions, the same `185:44` position, the same target `831:5`, the
same macro definition `554:14`, and correctly separated the direct
`is_new_arg` caller. It independently identified the unresolved `matches!` site
that the tool did not claim, which matches the extractor's stated limit.
