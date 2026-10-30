# Source audit

Four shipped TypeScript files byte-match the pinned release commit. produce documentation states original data and structural sharing; src/immer.ts states the base is returned when no modification occurs. finalize.ts returns base_ for unmodified state, otherwise copy_. immerClass.ts defaults autoFreeze_ to true; freezing documentation explicitly includes previously unfrozen plain objects that end up in the result. The probe tests values, identity and Object.isFrozen independently.

First-task update: root, task array and first task differ by identity; unchanged user and second task share identity. The original values match the pre-produce JSON. With default freezing, those shared objects become frozen; do not say no observable base change whatsoever. Two control recipes return the same root (no action and assigning the same boolean), and user-name modification changes the other branch. Each case receives a fresh input. No timing, allocation count, memory savings or rendering-frequency inference.

Both source trees are plain objects/arrays without aliases/cycles within one state. A diagram can have multiple incoming lines to a shared object when it depicts *two versions*; that does not imply arbitrary graph-shaped input is supported. Diagram labels must distinguish equal values from identical objects. A table of true/false should explicitly name the equality operation or translate it to same/new object.

Unchanged product runtime/package evidence is reused from round47. Content evidence must still check source resolution, actual rendered layout, complete copied code execution and an actual UI export. No new runtime suite needed for this authored specimen alone.

Parent checked a fourth module after author dispatch. This extra audit is retained outside the supplied source bundle as parent-immerClass.ts and parent-source-identity.json. The source identity file was briefly expanded and then restored to its original three-module content; no probe or primary-source content was changed. Author evidence remains the three-module bundle described by brief.md.
