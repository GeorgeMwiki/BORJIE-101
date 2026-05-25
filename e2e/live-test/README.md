# BORJIE `pnpm live-test` — full happy-path E2E

Ten sequential Playwright specs that drive the complete BORJIE
property-management happy path against a live Supabase project + a
running api-gateway. Where the rest of `e2e/tests/` mocks at the
api-gateway boundary or runs against a stubbed HTML server, `live-test`
is the opposite: **zero internal mocks**, real JWT verification, real
RLS policies, real ledger writes.

The only mock is the **M-Pesa STK callback** (we synthesize the
Safaricom-shaped payload in spec 06 because Daraja sandbox credentials
are not shipped to CI).

## What the suite exercises

1. **Owner signup** — Supabase Auth password sign-in produces a JWT the
   api-gateway accepts (`/api/me` returns 200).
2. **Tenant create** — owner creates a landlord org via the gateway;
   RLS is verified by a cross-tenant 404 probe.
3. **Property + 4 units** — owner adds a property with 4 deterministic
   units (A101..A104).
4. **Tenant-resident invite** — owner invites a customer-role user to
   unit-1; the invite is gated to the owner's tenant.
5. **Lease create** — owner links the invited resident to unit-1 with
   a 1-year lease, KES 45k/month, KES 90k deposit.
6. **Payment flow** — STK push initiated, synthetic Daraja success
   callback posted to the webhook, payment status polls to `completed`.
7. **Maintenance ticket** — tenant raises a plumbing ticket, manager
   triages it to `in_progress` + `priority=high`.
8. **Brain call** — three brain calls: routine (records DecisionTrace),
   high-stakes (should trigger three-voice debate), multi-step (should
   trigger LATS planner or reflexion). Wave 12 features (BL2, F9, F11)
   are verified end-to-end.
9. **Cross-tenant deny** — a user from an unrelated tenant probes every
   resource created in specs 02-08 and must get 403 / 404 / empty list
   for every one. This is the **deliberate** failure-mode check.
10. **Cleanup + cascade** — owner deletes the tenant via the GDPR
    RTBF endpoint; subsequent GETs on every resource return 404.

## Prerequisites

1. A Supabase project bootstrapped per
   [`Docs/SUPABASE_LIVE_TEST.md`](../../Docs/SUPABASE_LIVE_TEST.md):
   - all 148+ Drizzle migrations applied,
   - RLS enabled on the top-25 + phase-2 tables,
   - two test users created (the owner + a cross-tenant other).
2. The api-gateway running locally (or in CI) and reachable at
   `$API_GATEWAY_URL` (defaults `http://localhost:4000`).
3. The required environment block in `.env.local` (see the runbook
   at `Docs/RUNBOOKS/live-test.md` for the full table):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=…
   API_GATEWAY_URL=http://localhost:4000
   LIVE_TEST_OWNER_EMAIL=live-test-owner@borjie.test
   LIVE_TEST_OWNER_PASSWORD=…
   LIVE_TEST_OTHER_EMAIL=live-test-other@borjie.test
   LIVE_TEST_OTHER_PASSWORD=…
   ```

## Running

```bash
# Headless (default — what CI runs):
pnpm live-test

# Headed (single-step debug):
pnpm live-test:headed

# Single spec (e.g. just the brain step):
pnpm live-test:single -- e2e/live-test/08-brain-call.spec.ts
```

## What success looks like

- **10 / 10 specs PASS.**
- **0 RLS denials** except the 7 deliberate ones in spec 09 (those
  must succeed — the deny IS the success).
- The `report/` directory contains an HTML report; failures retain
  trace + screenshot + video.
- The Supabase project is left **empty** afterwards (tenant deletion
  cascade is verified by spec 10).

## Per-spec descriptions

| # | File | One-liner |
|---|---|---|
| 01 | `01-signup.spec.ts` | Supabase Auth signIn + api-gateway JWT verify |
| 02 | `02-tenant-create.spec.ts` | Owner creates landlord org; cross-tenant deny smoke |
| 03 | `03-property-add.spec.ts` | Property + 4 units (A101-A104) |
| 04 | `04-tenant-invite.spec.ts` | Invite customer-role user to unit-1 |
| 05 | `05-lease-create.spec.ts` | 1-year lease, KES 45k/mo, deposit KES 90k |
| 06 | `06-payment-flow.spec.ts` | M-Pesa STK + synthetic Daraja callback → completed |
| 07 | `07-maintenance-ticket.spec.ts` | Ticket open → triage → in_progress + high priority |
| 08 | `08-brain-call.spec.ts` | Brain Q&A + DecisionTrace + debate/LATS/reflexion |
| 09 | `09-cross-tenant-deny.spec.ts` | Other-tenant probes ALL resources → 403/404/empty |
| 10 | `10-cleanup.spec.ts` | RTBF delete + cascade assertions |

## When it fails

See the troubleshooting section in
[`Docs/RUNBOOKS/live-test.md`](../../Docs/RUNBOOKS/live-test.md).
Common failure modes covered:
- `globalSetup: api-gateway not reachable` — you forgot to start the
  gateway.
- `Supabase signIn failed: 400` — wrong password, or the test user
  doesn't exist yet.
- spec 02 RLS probe returns **200** instead of 404 — the api-gateway
  is not rebinding `app.tenant_id` on the connection.
- spec 06 webhook returns 404 on every path — the payments-ledger
  service isn't running.
- spec 08 returns 503 — no LLM creds in this environment; suite
  marks those tests `fixme()` rather than fail (acceptable for
  staging-without-LLM smoke).

## Why this is separate from `e2e/playwright.config.ts`

The main `e2e/` suite has 30+ specs and uses `fullyParallel: true`
across 4 frontend projects. It is **fast** but mocks at the gateway
boundary in some specs. `live-test` is **slow** (sequential, real
LLM, real DB), runs in its own config, and is gated to manual or
nightly CI runs (never on every PR).
