# Investigation Playbook

Purpose: produce a bounded coverage map in which every in-scope domain is inspected or explicitly excluded, then rank only candidates supported by contract evidence.

## Build a coverage map

Start with the largest or most central production surfaces, then partition the relevant system by responsibility rather than file type. Typical domains are:

- entrypoints, orchestration, and runtime control;
- public APIs, commands, configuration, and feature selection;
- domain state, caches, events, and lifecycle transitions;
- persistence, schemas, migrations, replay, and compatibility;
- protocols, plugins, dependency injection, reflection, and code generation;
- foreground and background execution, workers, processes, and resource ownership;
- packages, adapters, examples, scripts, tests, snapshots, and documentation.

Adapt the domains to the repository. For each domain, name the entrypoints inspected, central production paths read, searches run, history or decision records consulted, and unresolved blind spots. The coverage pass is complete when every in-scope domain is inspected or explicitly excluded with a reason.

When breadth warrants parallel investigation and the user has authorized it, give each worker a non-overlapping domain and require the same proof record. Aggregate by confidence and ownership boundary rather than arrival order or raw finding count.

## Hunt for maintenance burdens

Use these lenses to generate leads:

- **Dormant contract**: an export, hook, event, option, package, protocol field, or command has no current production consumer.
- **Split truth**: multiple states, summaries, caches, formats, or event families encode one fact and must remain synchronized.
- **Ownerless flexibility**: an abstraction, fallback, strategy, flag, or extension point promises possibilities no current product path owns.
- **Relay layer**: a wrapper, package, service, or route forwards behavior without reducing coupling or establishing a boundary.
- **Parallel state machine**: flags, promises, queues, sentinels, controllers, or callbacks describe the same transition.
- **Boundary theater**: validation, copying, rollback, or hostile-object defense sits on a trusted handoff rather than a real trust or ownership boundary.
- **Local infrastructure**: custom parsing, retry, framing, matching, diffing, scheduling, or collection code duplicates a suitable platform feature or dependency.
- **Support drag**: tests, examples, snapshots, generated expectations, or documentation are the only reason an otherwise unused surface remains.
- **Feature fossil**: implementation was abandoned or removed while schema, configuration, tests, compatibility logic, or design records still preserve its outline.

Do not equate visual similarity with duplication. Independent implementations may test an interface, isolate failure domains, protect different owners, or support distinct compatibility contracts.

## Climb the evidence ladder

Classify each lead by the strongest evidence reached:

1. **Smell**: complexity, duplication, or awkwardness is visible.
2. **Static lead**: a search or analyzer reports no or limited use.
3. **Consumer map**: every repository hit is classified and relevant callers and callees have been read.
4. **Contract proof**: dynamic loading, external use, persistence, compatibility, ownership, and design history have been resolved.
5. **Behavior proof**: a decisive check and recovery path demonstrate what would reveal a wrong change.

Smells and static leads are not deletion authority. High-confidence application normally requires contract proof and behavior proof.

## Classify consumers

Classify every hit instead of counting it:

- **Runtime**: shipped code, operational configuration, migrations, loaders, deployment scripts, and real entrypoints.
- **Support**: tests, documentation, comments, snapshots, examples proved to be illustrative only, and generated expectations.
- **Uncertain**: fixtures, public exports, examples that may double as smoke paths, plugin registrations, reflection, lazy imports, string dispatch, manifests, generated code, and external package consumers.

Search exact symbols and their alternate call forms, file and package names, configuration and environment keys, event and protocol strings, serialized field names, registry identifiers, and documentation examples. Read the surrounding control flow; search counts do not establish semantics.

Resolve uncertain consumers by inspecting registration and loading code, package publication boundaries, downstream repositories when in scope, persisted data, compatibility policy, and release history. If external consumption cannot be bounded, state the uncertainty and lower confidence.

## Read history as design evidence

Use blame, log, pull requests, issues, ADRs, RFCs, and comments to answer:

- What failure, requirement, or future plan introduced this surface?
- Does that condition still exist?
- Which current artifact owns the decision?
- What new evidence outweighs the original reason?
- What capability would become expensive to restore?

An old date or quiet file is only a discovery hint. A rejected historical alternative may still be valuable if it prevents a recurring mistake.

## Evaluate replacement dependencies

A standard-library feature or maintained dependency can reduce local responsibility, but only when it removes more obligation than it adds.

Compare exact semantics, unsupported residual behavior, maintenance and adoption, release cadence, security posture, transitive footprint, platform compatibility, migration cost, wrapper size, dedicated tests retired, and supply-chain exposure. Prefer platform facilities, then already-present dependencies, then a new dependency when the net ownership reduction is clear.

A wrapper that preserves most local policy while delegating a small primitive is not a simplification. Record the residual contract explicitly.

## Rank without gaming the result

Score independently:

- confidence in reachability and contract evidence;
- blast radius and reversibility;
- maintenance concepts retired;
- observable behavior or optionality surrendered;
- validation strength;
- implementation and migration cost.

Do not reward raw deleted lines, candidate count, or dramatic scope. No safe candidate is a valid evidence-backed result.
