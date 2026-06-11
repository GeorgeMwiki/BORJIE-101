# FLAG ACTIVATION PLAN — full-powers-default-on closure spec

**Date:** 2026-06-09
**Branch:** `integration/parity-final`
**Mandate:** Owner directive (locked invariant) — *"FULL POWERS ALWAYS DEFAULT ON FOR ANY USER"* + *"ASSUME ALL TEST USERS ARE PAYING USERS"* (TEST = PAYING: no stubs / degraded-fallbacks in user paths). Feature flags become **kill-switches** (verified-then-on), NOT off-by-default capability gates.
**Scope companion:** `Docs/research/MASTER_GAP_REGISTER.md` (FULL-POWERS-DEFAULT-ON + TEST=PAYING).
**Posture:** READ-ONLY classification pass. No code edited, no commit. This is a buildable, ordered spec for a follow-up flip-wave.

---

## Prerequisite status (verified this pass)

The directive named four security prerequisites as now-satisfied. All four are **confirmed wired as DEFAULT-ON, fail-closed kill-switches** (i.e. they only disable on an explicit off-token, never silently bypass):

| Prereq | Flag (kill-switch) | Wiring evidence | Default |
|---|---|---|---|
| IP-egress firewall / client-inspection | `BORJIE_EGRESS_FILTER` | `composition/egress-filter-wiring.ts:176` (`!(raw==='0'\|\|'false'\|'off'\|'no')` → default-on); consumed in `routes/brain.hono.ts:361/379`, `brain-dispatch.hono.ts:103`, `public-chat.hono.ts:102`, `brain-teach.hono.ts:951`, `brain-voice.hono.ts:116`, `mining/chat.hono.ts:57` via `getEgressFilter().guardFinal/guardStream` — FAIL-CLOSED (redacted on miss). | ON |
| Input-containment guard | `BORJIE_INPUT_CONTAINMENT` | `composition/input-guard-wiring.ts:79` (same default-on parse); consumed in `routes/brain.hono.ts:1966` `getInputGuard().guard(...)`. | ON |
| agent-security-guard | (always-on, no flag) | `@borjie/agent-security-guard` wired in `ai-copilot/src/orchestrator/orchestrator.ts` + `untrusted-content.ts` + `brain.ts`; backs both wiring modules above. SEC-G1 closed (task #17). | ON |
| Structural spotlighting (BP-3) | (always-on, no flag) | `central-intelligence/src/kernel/prompt-spotlight.ts` + applied in `kernel.ts` / `prompt-layers.ts`; BP-1/2/3/5 closed (tasks #49–52). | ON |

**Consequence:** the LLM hot path is wrapped by ingress containment + egress redaction + untrusted-content scanning + spotlighting, all on by default. This is the security floor that *unblocks* flipping the verified background-capability flags below. RLS FORCE and HITL-on-sovereign rails remain independent and untouched.

---

## Bucket 1 — FLIP-NOW (capability default-off → default-on, safe now)

Ordered lowest-risk-verified first. Each is a built capability whose any security prerequisite is already satisfied (egress/input guard, agent-security-guard, RLS FORCE, HITL-on-sovereign-steps).

### Group A — already-on by design; codify / correct the inventory (zero behavior change, do first)

1. **`BORJIE_PII_EXTENDED`** — *WHY:* extended-PII scrub on CoT / traces / logs; the directive wants privacy floors ON. *VERIFICATION:* the inventory's "off-unless-set" note is **wrong** — `getConfig()` runs the value through `privacySchema` which `.default('1')` (`packages/config/src/schemas.ts:111`), proven by `packages/config/src/schemas.test.ts:96` ("defaults BORJIE_PII_EXTENDED to '1' so prod ships with the scrub ON"). So `getConfig().BORJIE_PII_EXTENDED === '1'` is already TRUE when unset → **already on**. ACTION: none to flip; correct the inventory note and add a regression assert that an unset env yields scrub-on. (Treat as a security floor henceforth — see Bucket 3.)

### Group B — autonomous slow-loop / proactive supervisor (built + tested, propose-only)

2. **`BORJIE_ESTATE_MIND`** (`=== 'on'` to enable; default off) — *WHY:* the resident EstateMind Slow Loop is the autonomous heartbeat ("MD that never sleeps"); full-powers wants it live. *VERIFICATION:* it is **proposal-only** — `composition/estate-mind-wiring.ts:7-9` states it "emits self-formulated goals as PROPOSALS through the EXISTING gated proactive sink — it NEVER executes a sovereign/money/licence action (those stay HITL forever)"; runs leader-elected under `withServiceRoleContext` so RLS FORCE holds out-of-band; durable store on migration 0317; tasks #25–30 (situational-model + motivation + tick + migration + leader-elected wiring + tests) all completed. ACTION: change the enable token to default-on (e.g. only an explicit `off` disables), matching the worker-flag convention; keep leader-election + HITL sink unchanged.

### Group C — durable execution (engine present; flip only after wiring confirmed — see note)

> `DURABLE_EXEC_ENABLED` is intentionally **NOT** in FLIP-NOW. The inventory and `inngest-client.ts:143` confirm the engine reads the flag, but no live api-gateway composition reads `DURABLE_EXEC_ENABLED` (only the `/inngest` webhook route is mounted). Flipping it on changes nothing until the executor is wired → it belongs in NEEDS-PREREQ.

**Notes on the orchestrator main-loop pair** (`KERNEL_USE_ORCHESTRATOR`, `BORJIE_ORCHESTRATOR_MAINLOOP`): these are **already default-on** (`composition/brain-orchestrator-turn.ts:81-89` → unset returns `true`). No flip needed; they are correct kill-switches today. Listed here only to confirm they are NOT default-off.

**Notes on the ~30 background-worker `*_DISABLED` flags** (mwikila worker, proactive scheduler, bg-tasks, daily-brief cron, fx-feed cron, reminders, announcement-fanout, decision-retrospective, outcome-reconciliation, notification-dispatch, cases-SLA, entity-indexer, action-runner, geofence-watcher, ICA-cert cron, outbox, outcome-predictor): these are **already default-on** (each enables unless the literal `'true'`/`'false'` off-token is set). They already satisfy the directive — no flip needed. Each one is already a correct kill-switch. They are explicitly listed as "needsPrereq: none / already-on" so the flip-wave does not waste effort on them.

---

## Bucket 2 — NEEDS-PREREQ (should be on, concrete blocker first)

| Flag | Prereq before flip |
|---|---|
| **`DURABLE_EXEC_ENABLED`** | Wire `TaskAgentExecutor` through the Inngest durable wrapper in api-gateway composition (no `services.inngestRuntime` consumer reads this flag today; only `/inngest` webhook is mounted). Until the executor binding exists, flipping is a no-op. Then verify crash-resume parity vs the legacy sync executor before default-on. |
| **`CRON_LEADER_ELECTION`** | Default-off is correct for single-instance dev. Flip to default-on (or env-set per environment) ONLY once the deploy target is confirmed multi-replica; flipping on a single instance is harmless but flipping OFF on multi-replica causes duplicate cron firing. Tie the default to replica count, not a blanket flip. Prereq: confirm prod replica topology + advisory-lock table present. |
| **`PILOT_ENABLED` / `pilot_enabled` (DB)** | Pilot surface is deliberately opt-in to guard accidental deploys of cohort-tagged routes. "TEST=PAYING" means test users get full powers, but the pilot gate is a *cohort router*, not a capability gate. Flip per-cohort via the DB flag once the cohort + `PILOT_KILL_SWITCH_OPEN` precedence is validated; do not blanket-flip the env opt-in. |
| **`BORJIE_PILOT_MODE`** | Observability/Sentry-sampling posture only. Flip on per-environment when pilot observability is wanted; it is a tuning lever, not a capability — no user-path impact, so low urgency. |
| **`AUTH_PROVIDER`** | Routing lever between `legacy` and `supabase` auth paths. CLAUDE.md hard rule: "Supabase JWT is canonical." Confirm the supabase middleware path is the verified one before changing the default from `legacy`; this is an auth migration, not a feature flip — needs a deliberate cutover + test. |

---

## Bucket 3 — MUST-STAY-GATED (sovereign rails / security floors / unverified)

These must NEVER be blindly flipped to "off-by-default-no-guard." Reasons in-line.

### Sovereign / HITL kill-switches (money · licence · deletion · payout · four-eyes)
- **`killswitch_eviction` / `killswitch_payment_reversal` / `killswitch_account_deletion` / `killswitch_refund` / `killswitch_data_export` / `killswitch_monthly_close_reverse` / `killswitch_sublease_cancel` / `killswitch_sovereign_ledger_override`** (DB flags) — *REASON:* these guard the platform's highest-risk irreversible sovereign mutations; default-OFF means the guard *passes through* (operation allowed) and they are flipped *ON* by an operator to HALT. Lookup-error fails CLOSED in production (`kill-switch.middleware.ts:298`). This is the sovereign-rail HITL design — correct as-is, never auto-flip.
- **`PILOT_KILL_SWITCH_OPEN`** — *REASON:* emergency cohort-wide 503; highest precedence emergency lever. Must stay operator-controlled (default-off = pilot allowed).

### Platform / tenant administrative HALT levers (must stay operator-only)
- **`BORJIE_AI_KILL_SWITCH`** — *REASON:* master LLM kill-switch for cost-runaway / provider-incident / compliance-hold. Default-off (not active) is correct; it is the off-switch, not a capability.
- **`KILLSWITCH_STATE` / `KILLSWITCH_REASON` / `KILLSWITCH_TENANT_<id>` / `KILLSWITCH_TENANT_<id>_REASON`** — *REASON:* kernel administrative HALT/degraded. Default unset = `live` is correct; these are operator halt levers. NOTE: RSS-19 (`MASTER_GAP_REGISTER`) flags that HIGH-risk misconfig should fail-CLOSED — that is a *hardening* of this lever, not a flip; do not touch under this flip-wave.

### Security floors (already on — keep on, never flip off)
- **`BORJIE_JWT_ISS_AUD`** — *REASON:* G2 security floor (issuer+audience JWT validation). Already default-on; flip OFF only for incident rollback. Keep.
- **`BORJIE_EGRESS_FILTER`** — *REASON:* IP-egress / cross-tenant redaction firewall; default-on fail-closed. Security floor. Keep on.
- **`BORJIE_INPUT_CONTAINMENT`** — *REASON:* prompt-injection / jailbreak ingress containment; default-on fail-closed. Security floor. Keep on.
- **`BORJIE_PII_EXTENDED`** — *REASON:* extended-PII scrub; already on via schema default. Now treated as a privacy floor — keep on (and correct the inventory note per Bucket 1.1).

### Integrity / bootstrap levers (must stay off / unset in prod — flipping is unsafe)
- **`USE_MOCK_DATA`** — *REASON:* forces mock DB; THROWS in production by design. Must stay off in prod — flipping on is a data-integrity hazard, the opposite of TEST=PAYING.
- **`BORJIE_SKIP_DOTENV`** — *REASON:* bootstrap lever for test/container injected-env; not a feature gate. Leave as-is.

### Tunables (non-gating — out of scope for flip-wave)
- All `*_INTERVAL_MS` / `*_BATCH_SIZE` / `BORJIE_ESTATE_MIND_INTERVAL_MS` / `SOVEREIGN_LEDGER_VERIFY_INTERVAL_MS` / `WAKE_LOOP_INTERVAL_MS` / `OUTBOX_INTERVAL_MS` / `CRON_LEADER_RETRY_MS` — *REASON:* numeric tunables, not capability gates. No flip. (Sentinel `'0'` on the cron interval levers is a deliberate one-shot/external-CronJob mode, not a disable to flip.)

---

## Ordered flip sequence for the follow-up build wave

1. **`BORJIE_PII_EXTENDED`** — codify (no behavior change): correct the inventory + add the unset-env-yields-scrub-on regression assert. Lowest risk, proves the pattern.
2. **`BORJIE_ESTATE_MIND`** — flip enable-token to default-on; verified propose-only + leader-elected + RLS-safe + HITL-forever on sovereign. Re-run tasks #25–30 test set after flip.
3. **Confirm (no-op) the already-on set** — the orchestrator main-loop pair + ~30 worker `*_DISABLED` flags are already default-on; add a single test that asserts "unset env → enabled" for each so the directive is enforced by construction and cannot regress.
4. *(blocked)* **`DURABLE_EXEC_ENABLED`** — only after the api-gateway executor binding lands (NEEDS-PREREQ). Then verify crash-resume parity, then default-on.
5. *(env-scoped, not blanket)* **`CRON_LEADER_ELECTION`**, **`PILOT_ENABLED`/`pilot_enabled`**, **`BORJIE_PILOT_MODE`**, **`AUTH_PROVIDER`** — flip per-environment under their named prereqs, not as a blanket default.

**Never in any flip-wave:** every sovereign `killswitch_*` DB flag, `PILOT_KILL_SWITCH_OPEN`, `BORJIE_AI_KILL_SWITCH`, all `KILLSWITCH_*`, `USE_MOCK_DATA`, `BORJIE_SKIP_DOTENV`, and the security floors (`BORJIE_JWT_ISS_AUD`, `BORJIE_EGRESS_FILTER`, `BORJIE_INPUT_CONTAINMENT`, `BORJIE_PII_EXTENDED`) — these stay as designed.
