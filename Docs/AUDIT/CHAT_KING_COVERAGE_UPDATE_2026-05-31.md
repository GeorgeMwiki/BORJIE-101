# Chat-King Coverage Update (2026-05-31)

**Companion to** `CHAT_ACTION_COVERAGE_2026-05-29.md` (CE-1 wave).

The CE-1 wave closed 6/26 gaps and deferred 20 to sibling waves. This
update lifts 2 of those deferred items into real-DB-backed brain tools
and re-states the cross-repo (Borjie + BN) coverage tally per the
user's chat-king mandate ("everything can happen via home chat, user
never has to leave across all surfaces").

## 1. New tools landed this wave (`chat-king-followup-tools.ts`)

| Tool id | Persona | Stakes | Route |
|---------|---------|--------|-------|
| `ops.parties.create` | owner (T1) | MEDIUM | `POST /ops/external-parties` |
| `buyer.notifications.mark_read` | buyer (T5) | LOW | `POST /buyer/notifications/:id/read` |

Both wrap REAL existing gateway routes (Drizzle insert /
ai_audit_chain append for parties; real DB write of `read_at` for
notifications). No mock data, no fallback stubs. Loopback-dispatched
so auth + RLS + audit + kill-switch guards apply identically to a
browser request.

Provenance envelope (`provenance: { via: 'chat', sessionId, turnId,
actorId }`) threaded through every WRITE for deep-linking the audit
row back to the originating chat turn.

## 2. Borjie tally update

CE-1 closed: 225 → 231 / 251 = 92.0%
This wave closes 2 more: **233 / 251 = 92.8%**

| Surface | Mutation actions | Chat-tool present | Coverage |
|---------|-------------------|--------------------|----------|
| owner-web | 85 | 79 | 92.9% |
| admin-web | 38 | 30 | 78.9% |
| workforce-mobile | 71 | 64 | 90.1% |
| buyer-mobile | 40 | 37 | 92.5% |
| marketing | 17 | 17 | 100.0% |
| **TOTAL** | **251** | **233** | **92.8%** |

(owner-web +1 for `ops.parties.create`; buyer-mobile +1 for
`buyer.notifications.mark_read`.)

## 3. Cross-repo (Borjie + BN) chat-king tally

| Repo | Apps | Mutation actions | Chat-reachable | Coverage |
|------|------|------------------|-----------------|----------|
| Borjie | 5 | 251 | 233 | 92.8% |
| BN | 7 | 233 | 208 | 89.3% |
| **TOTAL** | **12** | **484** | **441** | **91.1%** |

## 4. Remaining 18 Borjie deferrals (vs original 20)

Lifted in this wave (2):
- ~~`ops.parties.create`~~ — landed
- ~~`mining.notifications.mark_read` (buyer side)~~ — landed as `buyer.notifications.mark_read`

Still deferred (18):

| # | Missing tool | Disposition |
|---|--------------|-------------|
| 1 | `admin.kill-switch.open` + `admin.kill-switch.close` | LANDED VIA G-FIX-5 (admin-inviolable-tools.ts) — audit doc outdated |
| 2 | `admin.policy.edit-rule` | LANDED VIA G-FIX-5 |
| 3 | `admin.four-eye.initiate` + `admin.four-eye.approve` | LANDED VIA G-FIX-5 |
| 4 | `admin.feature-flags.set` | LANDED VIA G-FIX-5 |
| 5 | `admin.corpus.re_ingest` (trigger re-ingestion) | DEFER — sibling brain-memory wave |
| 6 | `manager.attendance.correct` (fix clock-in/out) | DEFER — sibling payroll wave |
| 7 | `ops.estate.add-holding` (estate add) | DEFER — estate WRITE wave; needs schema |
| 8 | `ops.estate.log-capital-movement` | DEFER — estate WRITE wave; needs schema |
| 9 | `buyer.inquiries.send` | DEFER — sibling buyer-marketplace wave |
| 10 | `buyer.bids.accept-counter` | DEFER — sibling buyer-marketplace wave |
| 11 | `buyer.favourites.add` + `buyer.favourites.remove` | DEFER — needs backend route + favourites table |
| 12 | `mining.notifications.mark_read` (owner side) | BACKEND-GAP — owner notifications route is read-only |

After accounting for the G-FIX-5 admin tools that already shipped, the
ACTUAL remaining deferrals are 11 (not 20), making the de-facto
Borjie coverage closer to **240 / 251 = 95.6%** — but the CE-1 audit
doc's strict count stays at 92.8% until that doc is amended.

## 5. Verification

```bash
# distinct brain-tool IDs (Borjie)
grep -hE "^  id: '" services/api-gateway/src/composition/brain-tools/*.ts | sort -u | wc -l
# Expected: 150 (was 148; +2 from chat-king-followup-tools.ts)
```
