# Wave 19 Agent H+I — Error handling + Auth/authz

Agent hung before writing a summary. Report reconstructed from the code that landed on disk.

## What shipped

### `services/api-gateway/src/utils/safe-error.ts` (new, 196 lines)

Central helpers that fix the per-router catch-block leak pattern:

```ts
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ success: false, error: { code, message } }, 500);
}
```

That pattern bypasses the central error redactor and leaks raw Postgres
driver strings, constraint names, and file paths to clients. In production
it was shipping `/etc/secrets/foo` paths and `syntax error at or near
"SELEECT"` strings to API consumers.

Exports:

- **`scrubMessage(err, fallback)`** — dev: echoes the real message;
  prod: returns the fallback. Never returns a stack.
- **`safeInternalError(c, err, opts)`** — builds the standard envelope,
  logs the full error (name/message/stack) against the request's
  `requestId`, returns the Hono response with a scrubbed body.
- **`mapSqlError(err)`** — maps Postgres `SQLSTATE` codes to 4xx
  envelopes:

  | SQLSTATE | Semantic | HTTP | Envelope code |
  |---|---|---|---|
  | `23505` | unique_violation | 409 | `DUPLICATE_ENTRY` |
  | `23503` | foreign_key_violation | 409 | `FOREIGN_KEY_VIOLATION` |
  | `23502` | not_null_violation | 400 | `MISSING_REQUIRED_FIELD` |
  | `23514` | check_violation | 400 | `CONSTRAINT_VIOLATION` |
  | `22P02` | invalid_text_representation | 400 | `INVALID_INPUT_FORMAT` |
  | `42P01`, `42703` | undefined_table / column | (falls through to 500) | infra bug, not user |

- **`routeCatch(c, err, opts)`** — hybrid: tries SQL-error mapping
  first (4xx), falls back to `safeInternalError` (500/503). Adopted by
  all read-heavy routers.

### Routers adopted this wave (6)

- `services/api-gateway/src/routes/arrears.router.ts`
- `services/api-gateway/src/routes/credit-rating.router.ts`
- `services/api-gateway/src/routes/messaging.ts`
- `services/api-gateway/src/routes/org-awareness.router.ts`
- `services/api-gateway/src/routes/property-grading.router.ts`
- `services/api-gateway/src/routes/bff/customer-app.ts`

Every `catch (err) { return c.json(..., err.message) }` site in these
files was replaced with `routeCatch(c, err, {...})`.

### Test coverage

- `services/api-gateway/src/__tests__/safe-error.test.ts` (new, 152
  lines) — pins scrub behaviour, requestId propagation, SQL-error
  mapping, and prod-vs-dev divergence.
- `services/api-gateway/src/routes/__tests__/role-gate.test.ts` (new,
  188 lines) — pins tenant-isolation + role-gate enforcement across
  representative routes. (Note: 6 tests in this file were reported by
  Agent F as pre-existing failures; actual current state verified at
  commit time: all 173/173 api-gateway tests passing.)

## Open follow-ups (not fixed this agent run)

- Remaining ~50 routers still use the bare catch pattern. Adoption of
  `routeCatch` should continue in subsequent waves. The utility is in
  place and the call sites are mechanical replacements.
- Tenant-isolation audit across every raw `db.execute(sql\`...\`)`
  site was in scope but the agent hung before completing it. Carry
  forward to the next wave.

## Verification at commit time

- `pnpm --filter @borjie/api-gateway typecheck` → 0 errors.
- `pnpm --filter @borjie/api-gateway test` → 173/173 passing
  (up from 154 pre-wave — +19 new from safe-error + role-gate tests).
