# ADR 0009 — Composition-root wiring in api-gateway

- **Status:** Accepted
- **Date:** 2026-03 (BL6 + CL-4-IMPL)

## Context

As the modular monolith grew past 30 packages, service-to-service
wiring drifted into ad-hoc singletons inside individual modules.
This made testing painful (no clean replacement of dependencies),
hid cross-cutting concerns (audit + OTel weren't always applied),
and let circular boot orderings creep in.

Options considered:

| Option | Verdict |
|---|---|
| InversifyJS / tsyringe DI container | Reflection-based; runtime overhead |
| Awilix | Better but still hidden wiring |
| Manual composition root | Selected |
| Service-locator singleton | Hides wiring; testability bad |

## Decision

A single composition root lives in `services/api-gateway/src/index.ts`
(and a sibling for each long-running worker). All services,
repositories, sinks, and singletons are constructed once at boot
and passed explicitly. The four-eye gate, OTel SDK, audit sink,
and event bus are wired here before any route mounts. Test
harnesses use a parallel composition root with in-memory sinks.

## Consequences

**Positive:**

- Wiring is grep-able in one file.
- Tests replace deps cleanly via a test composition root.
- Boot order is deterministic; cycles caught at boot.
- Observability boot order is guaranteed (OTel before any span).

**Negative:**

- The composition root is long — discipline required to keep it
  organised by tier.
- Adding a new package requires editing the composition root.

## Alternatives considered

Awilix would reduce boilerplate but at the cost of grep-ability.
The manual composition root is the LITFIN-mirrored pattern (BL6).

## References

- `services/api-gateway/src/index.ts`
- `services/outbox-processor/src/index.ts`
- `services/consolidation-worker/src/index.ts`
- BL6 task + CL-4-IMPL aggregator rewrite
- `Docs/CODEMAPS/api-gateway.md`
