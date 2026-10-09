# Decision Record Cleanup

Purpose: keep the repository's current design owner accurate without erasing historical rationale that still prevents mistakes.

Follow the repository's native lifecycle, naming, pairing, and archival conventions. Historical records may be intentionally immutable; update their current owner and links instead of rewriting frozen history.

## Find the current owner

Trace shipped code, configuration, schemas, generated catalogs, package documentation, newer decisions, and inbound links. Titles and dates help discovery but do not prove ownership.

Classify the older record:

- **Current** when it still owns a live contract, compatibility rule, durable representation, or independently useful rejected alternative.
- **Partly displaced** when some of its behavior survives under a newer owner.
- **Fully displaced** when no production, configuration, schema, persisted, wire, migration, compatibility, or documented capability remains and a current record can carry all durable rationale.

## Consolidate without erasing lessons

Before retiring a fully displaced record, transfer unique rationale, alternatives, consequences, shipped evidence, known gaps, capability surrendered, conditions for reintroduction, and the reason the original motivation no longer wins. Implementation inventories and tests that described only deleted behavior need not survive as design rationale.

Repair inbound links, indexes, generated catalogs, paired translations, and consistency metadata as required by the repository. Search exact filenames, symbols, configuration keys, protocol strings, and record titles afterward.

Keep records separate when the underlying feature survives through another delivery route or implementation, when stored or compatibility behavior remains, or when consolidation would hide a still-useful warning against reintroducing a failed design.

Report the old and current owners, evidence for the classification, rationale transferred, links repaired, validation performed, and any record deliberately retained.

## Match the artifact to the decision

Use the repository's existing decision mechanism. A durable proposal should identify the present contract and consumer evidence, the exact removal or consolidation, the strongest reason to keep the design, the capability surrendered, acceptance criteria, risks, and verification boundary. Consolidate overlapping proposals under the record that already owns the decision instead of creating competing sources of truth.

Use a short local TODO, FIXME, issue, or equivalent only for a small actionable cleanup that does not need a durable architectural decision. Give it a stable searchable topic tag when repository conventions allow, then name the concrete burden and the condition that would make the change safe. Keep uncertain or product-level questions in the evidence report rather than depositing speculative annotations throughout the codebase.

Respect the selected authority mode: Survey mode reports the appropriate artifact without creating it unless the user requested repository edits.
