# LP-30 Canary Runbook — composition-root flag activation

**Audience:** platform operator running a staging→canary→prod rollout.
**Scope:** the five LP-30 composition-root seams turned on one at a time, with a
verification gate between each.
**Companion scripts:** [`enable-flags.sh`](./enable-flags.sh) (prints the order +
per-step checks), [`boot-smoke.ts`](./boot-smoke.ts) (the local boot proof).

> Nothing here is auto-applied. Flags are environment variables read at process
> **boot**; turning one on is a config change + rolling restart the operator
> performs via the deploy platform / IaC. Rollback is always: **unset the flag
> and roll the pods — no redeploy.**

---

## Flag inventory + code defaults

These defaults are what the code uses when the env var is **absent**. The
canary sets each one **explicitly** so the rollout is deterministic regardless
of default.

| Flag | Code default | Resolver | Seam |
|------|--------------|----------|------|
| `BORJIE_SEMANTIC_CACHE_ENABLED` | **OFF** | `flagDefaultOff` | LP-03 semantic cache |
| `BORJIE_INTENT_VERIFIER_ENABLED` | **ON** | `flagDefaultOn` | LP-04 intent verifier (advisory) |
| `BORJIE_INTENT_VERIFY_STRICT` | **OFF** (advisory) | `flagDefaultOff` | LP-04 enforce posture |
| `BORJIE_COGNITIVE_COMPOSER_ENABLED` | **OFF** | opt-in | LP-01 deep composer (LATS / Self-Discover) |
| `BORJIE_PRIVACY_ROUTER_ENABLED` | **ON** | `flagDefaultOn` | LP-15 privacy router |

> **Note on the two default-ON flags.** `BORJIE_INTENT_VERIFIER_ENABLED` and
> `BORJIE_PRIVACY_ROUTER_ENABLED` default ON in code, but both are **fail-safe**
> in their default posture (advisory-only verifier never blocks; privacy router
> only DENIES restricted data with no local model). For the **first** canary
> deploy (Step 0) set **every** flag in this table to `0` so the lights-off
> boot is unambiguous, then bring them up in the order below. The privacy
> router can be left at its default-ON in production once Step 0 is green; it is
> not part of the staged cost/latency-sensitive sequence.

---

## Step 0 — lights off

**Set:** every `BORJIE_*` flag in the table above to `0`.

**Action:** deploy the image to the target environment, then run the local boot
proof against the same code:

```sh
../../node_modules/.bin/tsx scripts/deploy/boot-smoke.ts
# or:  npx tsx scripts/deploy/boot-smoke.ts
```

**Gate (advance only when ALL true):**
- `boot-smoke` prints `RESULT: PASS` and exits 0.
- Service `/health` (or equivalent) green; pods stable, no crash-loop.
- Error rate + p95 latency flat vs. the previous release.

---

## Step 1 — semantic cache

**Set:** `BORJIE_SEMANTIC_CACHE_ENABLED=1`

**Watch:**
- Cache **hit-rate** climbs from 0 at representative traffic.
- p50 / p95 turn latency **does not regress** (a hit should be *faster*).
- **No** rise in wrong-answer or unexpected-refusal rate. Only `answer`
  decisions are cached, scoped per `(tenantId, surface, personaId)`, so a hit
  should be a legitimately-equivalent turn.

**Gate:** ≥ 30 min healthy; hit-rate > 0; latency flat-or-better; answers still
cite fresh evidence (the cache must not serve stale evidence chains).

**Rollback:** `unset BORJIE_SEMANTIC_CACHE_ENABLED` → cache degrades to a
permanent miss (every turn falls through to the normal sensor path). Roll pods.

---

## Step 2 — intent verifier (ADVISORY)

**Set:** `BORJIE_INTENT_VERIFIER_ENABLED=1` — **leave `BORJIE_INTENT_VERIFY_STRICT`
off.**

This is the **dry run**. In advisory posture a `permitted:false` rule match is
**logged** but the verdict returned to the kernel is forced to `permitted:true`,
so **no tool call is actually blocked**.

**Watch:** the warn-log volume:

```
lp30-intent-verifier: advisory — tool call WOULD be blocked in strict posture
```

Confirm the would-block matches are **true positives** (real SQL-injection /
data-exfil / prompt-injection-in-args) and not legitimate tool calls.

**Gate:** would-block volume understood + acceptable; no false-positive spike.
Capture the steady-state would-block rate — it is the **baseline** Step 4 must
match.

**Rollback:** `unset BORJIE_INTENT_VERIFIER_ENABLED`. Roll pods.

---

## Step 3 — cognitive composer

**Set:** `BORJIE_COGNITIVE_COMPOSER_ENABLED=1`

**Watch:** per-turn **LLM cost** and **p95 latency** on the qualifying turns the
TTC router escalates to Self-Discover (ambiguity 0.5–0.8) or LATS (critical
stakes / ambiguity > 0.8). Fast-path turns are unaffected (the composer returns
`null` and the brain keeps memory-recall-only enrichment).

**Gate:** cost + latency within budget; composer error-rate (→ fail-safe
fallback) low; answer quality non-regressed on escalated turns.

**Rollback:** `unset BORJIE_COGNITIVE_COMPOSER_ENABLED` → `runForTurn` short-
circuits to the fast path. Roll pods.

---

## Step 4 — intent verifier (STRICT) — enforce, do LAST

**Set:** `BORJIE_INTENT_VERIFY_STRICT=1` — **requires `BORJIE_INTENT_VERIFIER_ENABLED=1`
already on from Step 2.**

Now the real `permitted:false` verdict is **honoured**: the kernel drops the
offending tool call.

**Watch:** the **blocked-tool-call rate**. It should match the advisory
would-block baseline captured in Step 2. Confirm no legitimate flow is broken.

**Gate:** enforcement matches the advisory baseline; zero legitimate tool calls
denied. This is the only step that can refuse a tool call.

**Rollback:** `unset BORJIE_INTENT_VERIFY_STRICT` → back to advisory (matches
still logged, nothing blocked). Roll pods.

---

## Rollback summary

| Symptom | Action |
|---------|--------|
| Latency / cost regression after a step | Unset that step's flag, roll pods. No redeploy. |
| Legit tool call denied (Step 4) | Unset `BORJIE_INTENT_VERIFY_STRICT` (→ advisory). |
| Stale / wrong cached answer (Step 1) | Unset `BORJIE_SEMANTIC_CACHE_ENABLED`. |
| Composer errors / blowups (Step 3) | Unset `BORJIE_COGNITIVE_COMPOSER_ENABLED`. |
| Anything unexplained | Unset the most-recently-enabled flag first; each seam is fail-safe when off. |

Every seam is **fail-safe with its flag off**: cache → miss, verifier → permit,
composer → fast path, privacy router → passthrough. There is no flag whose
*off* state can break the hot path, which is why rollback never needs a
redeploy.
