# Creation guide

Read this reference only when you are deciding whether to declare something: a
domain is in front of you, the positions contract has said what each position
does, and the question left is whether this one is worth taking. Everything here
is guidance. Nothing in it is required, and a document that ignores all of it
still renders.

How much of it your pack repeats, splits, or keeps out of the reader's view is
your decision, and that choice is the whole cost: a pack that never mentions
clock bands costs its readers nothing, and a pack that repeats half of this page
on every use pays for it every time.

## A cost between two stops

Declare edge facts and an `accumulate` rule when the cost belongs to the leg and
the reader should watch it move. Leave it alone when the number is a one-off
remark: a sublabel is cheaper, stays true, and needs no rule to defend it.

## An order in time

Declare a clock when the document has a beginning and the stops follow it. Only
then do `{value}`, `{band}` and the reader's own moment mean anything; without a
clock those tokens promise something the document cannot keep, and the compiler
reports that instead of drawing an empty label.

## One day, read at more than one scale

Declare clock bands when the reader will ask where they are in the day, and choose
deliberately between the two shapes the positions contract describes. Measure
before you choose: an axis earns its width only when the lanes share their clock,
and a stop outside every band is reported rather than moved.

## An outside answer

Declare `links` when the reader will want the map, the review, or the ticket —
the thing the diagram cannot know. Declare `media` when the reader will ask what
the place looks like. Never declare either as decoration: both appear on focus,
and an unused one is invisible anyway.

## A reader who will change their mind

Declare `meta.reader` when the plan is expected to move — what happened, when
they arrived, how long they stayed. The artifact stays a file, and nothing is
written back to the document. If the past should stay visible rather than be
folded away, dim it and leave `view.stow` out.

## Words of your own

Put them in the document — `meta.types`, `meta.labels`, `meta.bands` — rather
than in a fork of the renderer. When two documents disagree about a word, that is
a conflict to report, not a default to pick.

## Tempted to add a field to the core

Ask the three questions in order: can the intent be expressed with the positions
that already exist, in which case it is yours to write; does another domain need
it, in which case it belongs in the core; is it a new field or a new grammar,
since a field is vocabulary and a grammar is the core's. A need seen once belongs
in your pack, and a need seen three times earns a position upstream.
