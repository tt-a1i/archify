# Boundaries and Lifecycle

Purpose: prove which boundary or lifecycle mechanisms protect distinct owners and transitions. Finish with every mechanism in the selected candidate mapped to a guarantee or classified as redundant.

## Locate the real boundary

For every validator, copy, freeze, capture, retry, rollback, or containment layer, identify the value's origin, current owner, next owner, mutation rights, lifetime, and failure domain.

Typical borrowed handoffs include private, same-process calls whose types and ownership conventions are enforced by one component boundary. Typical owned boundaries include untrusted input, configuration parsing, model or tool JSON, queues, storage, network protocols, plugins, workers, subprocesses, and data crossing asynchronous lifetime boundaries.

Defense on an owned boundary is part of the contract until evidence proves otherwise. Defense on a borrowed handoff may be removable when it protects only impossible or owner-violating behavior. Tests built from hostile getters, fake typed values, post-handoff mutation, or callback replacement reveal an assumed contract; determine whether production actually promises that contract before treating the test as authoritative.

Never trade away authorization, input trust validation, data-loss prevention, accessibility essentials, durable-format compatibility, or security isolation as an incidental cleanup.

## Draw the lifecycle graph

List the actors that can create, publish, start, settle, cancel, stop, flush, and dispose the resource. Then map every flag, promise, queue, sentinel, callback, controller, and terminal result to:

- the owner that writes it;
- readers that make decisions from it;
- the transition it represents;
- the race or failure it prevents;
- the cleanup or quiescence guarantee it completes.

Two mechanisms are redundant only when they represent the same transition for the same owner and protect the same failure window. Similar names are not enough. The lifecycle analysis is complete when every mechanism in scope is mapped to an owner, transition, failure window, and terminal guarantee, with unknowns made explicit.

Preserve distinct mechanisms when they separately guarantee atomic publication and rollback, isolate callback failures, arbitrate competing terminal outcomes, own a worker or process, bridge different durability levels, or make disposal wait until no work can escape.

When several mechanisms truly mirror one fact, choose the representation already observed at the strongest boundary. Route other readers to that owner and remove synchronization glue rather than creating another coordinator that leaves both truths alive.

## Prove quiescence

For cleanup changes, completion means more than returning from `dispose` or setting a stopped flag. Establish that no owned task can publish, mutate durable state, retain resources, or invoke callbacks after the terminal boundary.

Inspect timers, event listeners, streams, child processes, workers, pending promises, queues, retries, abort handlers, file descriptors, and deferred writes. Name the check that would reveal a late effect.

## Model races before deletion

For asynchronous candidates, write a small event table when ordering matters:

```text
Event or transition | owner | allowed predecessors | terminal effect | late-event behavior
```

Exercise at least the normal path, cancellation before start, cancellation during work, competing terminal outcomes, partial publication failure, and repeated cleanup when those states are reachable. Remove a branch only after its ordering guarantee is represented elsewhere or proven unnecessary.
