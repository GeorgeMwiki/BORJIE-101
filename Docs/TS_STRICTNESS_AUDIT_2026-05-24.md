# TS Strictness Audit — per-package opt-outs vs `tsconfig.base.json`

**Date**: 2026-05-24
**Scope**: 95 `packages/*/tsconfig.json` + `services/*/tsconfig.json` audited; root `tsconfig.base.json` left unchanged.
**Closes**: LITFIN parity audit gap #8 (`Docs/LITFIN_PARITY_DEEP_AUDIT_2026-05-24.md`).

## Why this audit

The audit found:

> "TypeScript strictness... `tsconfig.base.json` is **best-in-class**:
> `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
> `noImplicitOverride`... BUT: at least 1 package opts out of strict
> (`"strict": false`, `"exactOptionalPropertyTypes": false`). Some
> packages declare their own compiler options not extending base."

The base is best-in-class. The leak is at the per-package level — some
configs either don't extend the base or override its strict flags.

## Base config (UNCHANGED)

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    "ignoreDeprecations": "6.0"
  }
}
```

No further base-level tightening is justified for this pass: the base
already enables every flag inside `strict`, plus the four widely-cited
"strict-plus" additions (`noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`,
`noFallthroughCasesInSwitch`). Adding
`noPropertyAccessFromIndexSignature` is a much larger blast radius and
is deferred to a dedicated phase.

## Headline numbers (after this pass)

| Metric | Before | After |
|---|---|---|
| Tsconfigs audited | 95 | 95 |
| Extends `tsconfig.base.json` | 56 (59%) | **59 (62%)** |
| Total per-package opt-outs | 129 | **126** |
| Files with `@ts-nocheck` (under `src/`) | 165 | 165 |

## Categories of opt-out

1. **Strict opt-out** (`strict: false` or `noImplicitAny: false`) —
   the most damaging, disables every flag inside `strict`. Worst offenders:
   `services/api-gateway`, `services/brain-evolution-worker`,
   `services/consolidation-worker`, `services/proactive-triggers-worker`,
   `packages/ai-copilot`, `packages/browser-perception`,
   `packages/authz-policy`, `packages/market-intelligence`,
   `packages/marketing-brain`, `packages/observability`,
   `packages/realtime-rooms`, `packages/spotlight`.
2. **`noUncheckedIndexedAccess: false`** — kills the audit's
   distinguishing feature (arr[i] becomes T | undefined). 17 packages
   either explicitly override or fail to inherit it.
3. **`exactOptionalPropertyTypes: false`** — the runner-up.
   28 packages opt out, mostly to dodge a port/adapter signature
   that uses `{ foo?: string }` and assigns `undefined` literals.
4. **`@ts-nocheck` files** — escape-hatch files. 165 total across
   the repo; concentrated in `services/api-gateway` (119),
   `services/domain-services` (21), `packages/database` (19),
   `packages/api-client` (3), `packages/authz-policy` (2),
   `services/identity` (1).

## Removed-this-pass (3 lowest-risk packages)

These 3 packages already enabled every strict flag on their own
(without extending the base) and typecheck cleanly. Rewrote their
tsconfig to extend the base, drop the duplicated flags, and pick up
the implicit `noUncheckedIndexedAccess` it was missing.

| Package | Before (file size) | After (file size) | Lines saved | Net strictness change |
|---|---|---|---|---|
| `packages/assignment-registry` | 28 lines | 14 lines | 14 | gained `noUncheckedIndexedAccess` (was missing); typechecks clean |
| `packages/ai-reviewer` | 28 lines | 14 lines | 14 | gained `noUncheckedIndexedAccess` (was missing); typechecks clean |
| `packages/carbon-market` | 28 lines | 14 lines | 14 | gained `noUncheckedIndexedAccess` (was missing); typechecks clean |

Total: **42 lines saved**, 3 packages now extending base, 3 more under
`noUncheckedIndexedAccess` discipline.

## Prioritised opt-out backlog

Ordered by impact × effort (small + clean first). Each row is a
candidate for a follow-up PR. Effort estimates assume sticking to
the same "extend base + drop duplicated flags" pattern and that the
package typechecks cleanly today.

### Quick wins (single opt-out, small surface)

| Package | Opt-out | Effort | Risk |
|---|---|---|---|
| `services/field-capture-service` | `exactOptionalPropertyTypes=false` | S | low (4 src files) |
| `services/notifications` | `exactOptionalPropertyTypes=false` | S | low |
| `services/onboarding-orchestrator` | `exactOptionalPropertyTypes=false` | S | needs port-signature fix (`tenantId?: string` → `tenantId: string \| undefined`) |
| `services/outcomes-metering` | `exactOptionalPropertyTypes=false` | S | needs `noUncheckedIndexedAccess` cleanup first |
| `services/parcel-service` | `exactOptionalPropertyTypes=false` | S | needs missing-build of `@borjie/observability` first |
| `services/voice-agent` | `exactOptionalPropertyTypes=false` | S | typecheck regressions present |
| `services/reports` | `exactOptionalPropertyTypes=false` | S | low |
| `packages/design-system` | `exactOptionalPropertyTypes=false` | S | low (4 src files) |
| `packages/api-client` | `exactOptionalPropertyTypes=false`, `verbatimModuleSyntax=false` | S | 3 `@ts-nocheck` to retire first |
| `packages/authz-policy` | `strict=false`, `exactOptionalPropertyTypes=false` | M | 2 `@ts-nocheck` files |
| `packages/enterprise-hardening` | `strictNullChecks=false`, `exactOptionalPropertyTypes=false`, `noImplicitOverride=false` | M | review null-handling discipline first |

### Medium difficulty (multiple opt-outs, broader surface)

| Package | Opt-outs | Effort | Why deferred |
|---|---|---|---|
| `packages/ai-copilot` | `strict=false`, `exactOptionalPropertyTypes=false` | M | large surface, many consumers |
| `packages/market-intelligence` | `strict=false`, `exactOptionalPropertyTypes=false` | M | hand-rolled adapter shapes |
| `packages/marketing-brain` | `strict=false`, `exactOptionalPropertyTypes=false` | M | same |
| `packages/observability` | `strict=false`, `exactOptionalPropertyTypes=false` | M | OTel SDK type leakage |
| `packages/realtime-rooms` | `strict=false`, `exactOptionalPropertyTypes=false` | M | Y.js + WebSocket shape |
| `packages/spatial-engine` | `noUncheckedIndexedAccess=false`, `exactOptionalPropertyTypes=false` | M | dense array math, audit each access |
| `packages/spotlight` | `strict=false`, `exactOptionalPropertyTypes=false` | M | |
| `packages/geo-platform` | `noUncheckedIndexedAccess=false`, `exactOptionalPropertyTypes=false` | M | |
| `packages/browser-perception` | `strict=false`, `exactOptionalPropertyTypes=false` | M | DOM types interact |
| `packages/domain-models` | `exactOptionalPropertyTypes=false`, `verbatimModuleSyntax=false` | M | exports shared across the repo — large blast radius |
| `packages/chat-ui` | `noUncheckedIndexedAccess=false`, `exactOptionalPropertyTypes=false` | M | React component shapes |
| `packages/genui` | `noUncheckedIndexedAccess=false`, `exactOptionalPropertyTypes=false` | M | |
| `services/identity` | `noUncheckedIndexedAccess=false`, `exactOptionalPropertyTypes=false` | M | 1 `@ts-nocheck` file |
| `services/document-intelligence` | `noUncheckedIndexedAccess=false`, `exactOptionalPropertyTypes=false` | M | OCR adapter shapes |
| 5 × `services/mcp-server-*` | `noUncheckedIndexedAccess=false`, `exactOptionalPropertyTypes=false` | M | MCP SDK type leakage; tighten all 5 together |

### Big rocks (require campaign-level cleanup)

| Package | Opt-outs | Effort | Why deferred |
|---|---|---|---|
| `services/api-gateway` | `strict=false` + 5 more | XL | 119 `@ts-nocheck` files; campaign-scale cleanup needed (separate phase) |
| `services/payments-ledger` | 5 explicit `false` + 3 missing | L | distinct base — needs migration to `tsconfig.base.json` first |
| `services/domain-services` | 2 opt-outs + 21 `@ts-nocheck` | L | service-registry plumbing, very high coupling |
| `packages/database` | 2 opt-outs + 19 `@ts-nocheck` | L | Drizzle row-type leakage drives most of the `@ts-nocheck` |
| 4 × `services/*-worker` | full strict opt-out | L | tighten all 4 together with shared base |
| 30 × packages with `noUncheckedIndexedAccess-missing` | 1 missing inherit each | L (per package, S total) | bulk auto-fix: rewrite each to extend `tsconfig.base.json` |

## Bulk-fix script (deferred)

A follow-up script (`scripts/ts-tighten-tsconfigs.mjs`) can mechanically
rewrite all 30 `noUncheckedIndexedAccess-missing` packages to extend the
base, since their existing per-file copies are byte-for-byte clones of
the same 28-line template. Estimated effort: 1 day to write + 1 day
to verify per-package typecheck.

## Notes on `@ts-nocheck` files

`@ts-nocheck` is the strongest opt-out — it disables the compiler
entirely on that file. The 165 files concentrated in api-gateway (119)
and a few other long-running services suggest the conventional
"escape-hatch" pattern used during fast wave-style development; each
file should grow a TODO + ticket reference and a removal-by date.

This audit does NOT enforce removal; that's a separate campaign.
