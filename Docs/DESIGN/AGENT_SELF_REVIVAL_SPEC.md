# AGENT SELF-REVIVAL SPEC

**Status:** Draft v1 — Wave 18DD
**Owner:** Platform orchestration
**Companion service:** `services/wave-resilience-manager/`

> "Company self revive and complete all crashed agents to 100%.
>  Improves even when owners and people sleep." — founder directive

---

## 1. The problem

The platform dispatches long-running agent waves (research, refactor,
migration, scaffolding). Each wave is one or more model calls into the
Anthropic API, often spanning 5–40 minutes. Across the last weeks we
have observed a recurring failure pattern:

- **ECONNRESET** mid-stream, dropping the partial response.
- **Certificate errors** (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`) when an
  intermediate CA momentarily fails to renew.
- **ConnectionRefused** to internal sidecars (Tavily proxy, Exa proxy,
  search-cache redis) during deploys.
- **Process OOM** on the orchestrator host when a fan-out wave bursts
  past the heap ceiling.

In each case the agent had already produced partial value — files
written to disk, commits landed, even pushes to remote — but the
**final reporting back to the orchestrator** died. From the
orchestrator's perspective the wave never completed. From the repo's
perspective it _almost_ did.

Today the operator response is: read the git log, infer what was done,
manually craft a continuation prompt, dispatch a new agent. This is
slow, fragile, requires human attention, and breaks the founder's
"complete even while we sleep" requirement.

This spec codifies **autonomous self-revival**: every wave is
resumable; the system detects crashes; it dispatches a continuation
agent from the last successful checkpoint; it drives the wave to true
100% completion without human intervention.

---

## 2. The principle

**Every wave is RESUMABLE. Every wave declares CHECKPOINTS. The system
DETECTS crashes and RESUMES from the last checkpoint. Waves complete
to 100% even through multiple infrastructure failures.**

Three corollaries:

1. **State lives in Postgres, not in process memory.** Any agent that
   crashes can be replaced by another agent that reads the durable
   checkpoint and continues.
2. **Progress is monotonic per-wave.** A wave never goes backwards. A
   resumed agent skips already-completed steps via git+filesystem
   verification.
3. **Bounded retries.** The system never enters an infinite revival
   loop. After 3 attempts a wave is escalated to operator-attention.

---

## 3. The four resilience guarantees

### R1 — Atomic progress

Every step writes a checkpoint to the durable store **before** the
next step starts. If the agent dies between steps, the checkpoint is
already persisted; the next agent picks up from there.

### R2 — Crash detection

A heartbeat protocol. Every dispatched agent emits a `wave.heartbeat()`
signal every 30 seconds during long operations. The resilience manager
runs a 60-second scanner: if a wave is in status `running` and its
last heartbeat is older than 5 minutes (10× the heartbeat cadence,
generous against pause-the-world GCs), the manager declares the wave
`crashed`.

### R3 — Autonomous resume

When a wave is `crashed` and a checkpoint exists, the manager:
1. Reads the original dispatch prompt + last checkpoint payload.
2. Assembles a continuation prompt from a fixed template.
3. Dispatches a fresh general-purpose agent with the continuation
   prompt.
4. Marks the wave as `resuming`, increments `attempt_number`.

### R4 — Bounded retries

Maximum **3** resume attempts per wave. On the third failure the wave
transitions to `unrecoverable`, an `operator-attention` notification
fires, and the manager stops touching the wave. This prevents
catastrophic resource burn on a fundamentally broken wave (e.g. one
that crashes because the underlying task is malformed).

---

## 4. Wave lifecycle state machine

```
   dispatched ─→ running ─→ (checkpoint*) ─→ completed
                    │
                    └─→ crashed ─→ revivable ─→ resuming ─→ running ─→ …
                                                                       │
                                                                       └→ completed (eventually)

   crashed ─→ unrecoverable (after 3 attempts) ─→ operator-attention
```

The eight states are:

| State | Description |
| --- | --- |
| `dispatched` | Wave row exists; agent not yet picked up. |
| `running` | Agent is alive, emitting heartbeats. |
| `checkpoint` | Transient state during checkpoint write. |
| `completed` | Wave reached terminal success (commits + push). |
| `crashed` | No heartbeat > 5 min. Detector wrote this. |
| `revivable` | Decider confirmed: checkpoint exists, attempts < 3. |
| `resuming` | Continuation agent dispatched. |
| `unrecoverable` | 3 attempts exhausted; operator alert fired. |

`checkpoint` is intentionally a transient state — it exists for the
window between "start of checkpoint write" and "checkpoint write
committed". The detector's heartbeat-staleness check excludes
`checkpoint` rows to avoid racing with in-flight writes.

---

## 5. The `WaveProgressLedger` contract

```typescript
export interface WaveProgressEntry {
  readonly id: string;                       // uuid
  readonly wave_id: string;                  // '18DD', '18CC', etc.
  readonly agent_id: string;                 // anthropic agent task id
  readonly tenant_id: string | null;         // null for platform-level waves
  readonly status:
    | 'dispatched'
    | 'running'
    | 'checkpoint'
    | 'completed'
    | 'crashed'
    | 'revivable'
    | 'resuming'
    | 'unrecoverable';
  readonly checkpoint_seq: number;           // monotonic per wave
  readonly checkpoint_label: string;         // 'audit_complete' | 'spec_drafted' | …
  readonly checkpoint_payload: Record<string, unknown>;
  readonly heartbeat_at: string;             // ISO timestamp
  readonly attempt_number: number;           // 1, 2, 3
  readonly created_at: string;
  readonly audit_hash: string;               // @borjie/audit-hash-chain
}

export interface RevivalDecision {
  readonly wave_id: string;
  readonly should_revive: boolean;
  readonly last_completed_checkpoint: string | null;
  readonly continuation_prompt: string;
  readonly attempt_number: number;
  readonly reason: string;
}
```

All progress entries are sealed with the `@borjie/audit-hash-chain`
primitive (`audit_hash`), so the orchestration ledger is itself
tamper-evident.

---

## 6. The resilience-manager service architecture

```
services/wave-resilience-manager/
   ├── crash-detector              (every 60s scan)
   │     - reads wave_progress
   │     - for status='running' with heartbeat older than 5min → mark 'crashed'
   │
   ├── revival-decider
   │     - for each 'crashed' wave: compute RevivalDecision
   │     - if attempt < 3 + checkpoint exists → mark 'revivable'
   │     - if attempt >= 3 → mark 'unrecoverable' + escalate
   │
   ├── continuation-prompt-builder
   │     - reads original dispatch + last checkpoint
   │     - assembles a "resume from checkpoint X" prompt
   │
   ├── agent-resumer
   │     - dispatches a new general-purpose agent
   │     - increments attempt_number; moves wave to 'resuming'
   │
   └── completion-watcher
         - watches for commit + push to remote
         - on success → moves wave to 'completed'
         - all transitions audit-chained
```

Each sub-module is composed against an interface, not against
infrastructure. Tests use in-memory adapters; production wires the
Drizzle-backed repositories.

---

## 7. Checkpoint protocol

Every dispatched agent must:

| Step | Call | Notes |
| --- | --- | --- |
| 1 | `wave.checkpoint('audit_complete', { audit_findings })` | After audit/research step. |
| 2 | `wave.checkpoint('spec_drafted', { word_count, sections_done })` | After spec/doc draft. |
| 3 | `wave.checkpoint('package_scaffolded', { files_count })` | After source scaffold. |
| 4 | `wave.checkpoint('committed', { commit_hashes })` | After each commit. |
| 5 | `wave.checkpoint('pushed', {})` | After push to remote. |
| _during_ | `wave.heartbeat()` every 30s during long operations. |

Existing agents do not yet call this. **Migration path:** for already-
dispatched waves the resilience manager **infers** checkpoints from
git log — a commit whose message starts with the wave's prefix (e.g.
`docs(resilience):`, `feat(db):`, `feat(wave-resilience-manager):`)
maps to a known checkpoint label by simple regex. New agents adopt the
explicit protocol via a tiny `@borjie/wave-checkpoint-client` SDK
(future wave).

---

## 8. The autonomous-resume prompt template

```
You are RESUMING wave {wave_id} which was previously dispatched but
crashed mid-flight.

Original prompt (verbatim):
{original_prompt}

Last successful checkpoint:
  label:   {checkpoint_label}
  seq:     {checkpoint_seq}
  payload: {checkpoint_payload}

Resume from where the previous attempt left off. Before each step,
verify it has not already been done by checking:
  - `git log --oneline -20` for commits matching the expected prefixes
  - `git ls-files` for files already tracked
  - the filesystem for already-written artefacts

Skip any step whose output already exists. Complete the remaining
steps. Do not re-create files that already exist; modify in place if
needed.

This is attempt {attempt_number} of 3. Be efficient — every minute
counts. Report when complete.
```

The prompt is assembled by `continuation-prompt-builder` and fed to a
fresh general-purpose agent invocation. The agent's first action is
always a verification pass.

---

## 9. Anti-patterns

| Anti-pattern | Why it's forbidden |
| --- | --- |
| Re-running a wave from scratch when checkpoints exist | Wastes compute, may duplicate commits, breaks idempotency. |
| Infinite revive loop on a broken wave | 3-attempt cap with escalation to operator. |
| Resume without verifying partial work | Must always `git status` + filesystem check first. |
| Resume that commits duplicate files | Must always `git ls-files` before re-creating. |
| Heartbeat that lies | Heartbeat means "I am about to do real work next", not "I am alive but stuck". Agents must heartbeat at the start of each sub-step, not as a background timer. |
| Checkpoint without payload | Empty payload defeats resume. At minimum include enough context to verify the step was actually done. |

---

## 10. Schema additions

```sql
CREATE TABLE wave_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wave_id text NOT NULL,
  agent_id text NOT NULL,
  tenant_id text,
  status text NOT NULL DEFAULT 'dispatched',
  checkpoint_seq int NOT NULL DEFAULT 0,
  checkpoint_label text,
  checkpoint_payload jsonb,
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  attempt_number int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  audit_hash text NOT NULL
);
CREATE INDEX idx_wp_wave_recent ON wave_progress (wave_id, created_at DESC);
CREATE INDEX idx_wp_status      ON wave_progress (status, heartbeat_at);

CREATE TABLE wave_revival_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wave_id text NOT NULL,
  attempt_number int NOT NULL,
  original_dispatch_at timestamptz NOT NULL,
  crashed_at timestamptz NOT NULL,
  resumed_at timestamptz,
  completed_at timestamptz,
  outcome text,                              -- completed|crashed_again|gave_up
  audit_hash text NOT NULL
);
```

Both tables are platform-level (no tenant scoping) because they track
orchestration health, not customer data. RLS is therefore not applied
— access is restricted at the application layer by API key.

The companion Drizzle schema lives at
`packages/database/src/schemas/wave-resilience.schema.ts` and is
exported from the schemas barrel.

---

## 11. Owner-touch points

The resilience manager exposes three operator surfaces:

- **Admin UI panel** — table of waves with columns: `wave_id`,
  `status`, `last heartbeat`, `attempt`, `last checkpoint`. Read from
  `GET /report` on the manager service.
- **Notifications** — on `unrecoverable` the manager fires a
  `wave.unrecoverable` notification through the existing notification
  sink, addressed to owner + on-call operator.
- **Daily briefing line item** — the morning briefing (research-
  orchestrator's `daily-briefing-cron`) includes:
  > "Overnight: {n_completed} waves completed, {n_revived} self-revived
  >  after a crash, {n_unrecoverable} unrecoverable."

---

## 12. SLOs

| Metric | Target | Rationale |
| --- | --- | --- |
| Crash detection latency | ≤ 5 min (one heartbeat-staleness window) | Catch crashes within a single sweep. |
| Time-to-resume | ≤ 6 min from crash to `resuming` | Detector (≤ 60 s) + decider (instant) + dispatcher. |
| Resume success rate | ≥ 80% on attempt 1, ≥ 95% by attempt 3 | A wave that fails 3× is genuinely broken. |
| False-positive crashes | ≤ 1 per week | Heartbeat-staleness window must be generous enough. |

---

## 13. Open questions for the founder

1. **SLO for resume latency** — is 6 min acceptable, or do we want a
   tighter 2-min loop with a 30 s detector cadence (costs CPU)?
2. **Owner-notification channel** — SMS, Slack, email? Today the
   notifications sink defaults to logging only.
3. **Should the manager auto-merge resumed wave commits to `main`** or
   require operator approval on attempts ≥ 2?
4. **Cross-repo waves** — when a wave spans Borjie + BossNyumba, does
   the revival run in both, or is one repo authoritative?
5. **Retry budget per day** — should we cap the total revival
   attempts per 24h (e.g. 50) to bound infrastructure spend even when
   each individual wave respects the 3-attempt cap?
