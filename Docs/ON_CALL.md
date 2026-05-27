# Borjie On-Call Rotation & Escalation

**Last Updated:** 2026-05-27
**Owner:** Mr. Mwikila (founder)
**Audience:** All Borjie engineers participating in pilot weeks.

This document is the source of truth for who responds when something
breaks during the Tanzania pilot. The companion automation is in
`services/consolidation-worker/src/tasks/sentry-to-github.ts` (errors
→ GitHub Issues) and `Docs/runbooks/*` (one runbook per known
failure).

## Rotation schedule (weekly)

The rotation runs Monday 09:00 EAT → Monday 09:00 EAT. Each week has
one **primary** and one **backup**. Both must be reachable on the
documented channels.

```
Week of                | Primary           | Backup            | Notes
-----------------------|-------------------|-------------------|--------------------
Wk 1  2026-05-25 → 06-01 | @mwikila         | @engineer-alpha   | Pilot Days 1-7
Wk 2  2026-06-01 → 06-08 | @engineer-alpha  | @engineer-beta    | Pilot Days 8-14
Wk 3  2026-06-08 → 06-15 | @engineer-beta   | @engineer-gamma   | Post-pilot wk 1
Wk 4  2026-06-15 → 06-22 | @engineer-gamma  | @mwikila          | Post-pilot wk 2
```

Update the schedule before each Monday morning via PR to this file.
Calendar invites + PagerDuty schedule mirror this table.

## Escalation path

Every error follows the same ladder. The bridge automates step 1-3;
on-call lives at steps 4-6.

```
1. Pilot user hits error
   └─ Mobile/web client surfaces in-app feedback prompt
2. In-app feedback recorded
   └─ Auto-attaches Sentry breadcrumbs (PII-scrubbed)
3. Sentry → GitHub bridge creates an Issue
   └─ Issue labelled `pilot`, `cohort:<name>`, `severity:<level>`,
      `runbook:<slug>` (if a runbook is mapped)
   └─ Slack post to #pilot-alerts with link to issue + runbook
4. On-call primary acknowledges in Slack (target: 30 min during
   pilot hours 06:00-22:00 EAT)
5. If primary doesn't ack within SLA → backup is paged
   automatically (PagerDuty re-routing rule)
6. If backup doesn't ack within SLA → CTO (currently founder
   Mr. Mwikila) is paged
```

### Pilot hours (when SLAs apply)

- **Pilot hours**: 06:00 – 22:00 East Africa Time (UTC+3), 7 days/wk
  for pilot duration.
- **Out-of-hours**: only P0 pages. P1 / P2 / P3 wait until 06:00 EAT.
- During pilot Days 6-10 specifically (bug-surge window), expand pilot
  hours to 04:00 – 23:00 EAT to match field activity in artisanal
  mining sites that start before dawn.

## Severity ladder

Severity is set by the Sentry → GitHub bridge based on Sentry's
`level` tag and the issue's `cohort_size` (how many users it
affects). On-call may upgrade or downgrade by editing the GitHub
label (audit-logged).

| Severity | Definition                                                | SLA ack | SLA mitigate | Page? |
| -------- | --------------------------------------------------------- | ------- | ------------ | ----- |
| **P0**   | Entire cohort affected OR data-loss risk OR auth broken   | 15 min  | 1 hour       | Yes   |
| **P1**   | Single user blocked on a core workflow (photo, sync, FX)  | 30 min  | 4 hours      | Slack |
| **P2**   | Degraded UX, workaround exists (CSV vs PDF, etc.)         | 1 hour  | 12 hours     | Slack |
| **P3**   | Cosmetic, low-volume, in-app self-recovery works          | 4 hours | next sprint  | No    |

### P0 — page criteria (precise)

A P0 incident requires **any one of**:

- ≥30% of an active cohort (>5 users) hits the same error in 10
  minutes.
- Sentry event `level=fatal` AND user is in an active pilot cohort.
- Any data-loss-class error: `offline-sync-queue-stuck` with DLQ
  growth, ledger posting failures, audit-hash-chain breaks.
- The fail-closed kill-switch fired unexpectedly.
- Auth fully broken (OTP delivery 0% for any TZ carrier in 15m).

### P1 / P2 / P3 (no paging — Slack only)

- **P1**: in-app blockers for individual users. Bridge files an Issue
  and posts to #pilot-alerts. On-call ack in Slack.
- **P2**: degraded but recoverable. Bridge files Issue, posts to
  #pilot-alerts-low. Daily standup triages.
- **P3**: cosmetic, parked on the next-sprint board automatically.

### Pilot-mode default

**Every error is at least P2 by default during pilot weeks**, even if
Sentry would have called it P3 in production. Rationale: pilot users
see fewer total errors but each one disproportionately shapes
confidence. On-call can downgrade after triage.

## Channels

| Channel             | Purpose                                            |
| ------------------- | -------------------------------------------------- |
| `#pilot-alerts`     | P0/P1 issues, runbook-linked. Bridge auto-posts.   |
| `#pilot-alerts-low` | P2 issues. Triaged at daily standup.               |
| `#pilot-field-ops`  | Pilot lead reports user-side observations.         |
| PagerDuty           | P0 paging. Route: borjie-oncall-primary → backup.  |
| Phone (founder)     | Only after PagerDuty has paged primary AND backup. |

## Triage runbook (every issue, in order)

When you (on-call) get a new GitHub issue from the bridge:

1. **Ack in Slack** within SLA. Format: `:eyes: ack {issue_url} —
   starting triage.`
2. **Read the linked runbook** under `Docs/runbooks/<slug>.md`. If
   the bridge linked one, follow it before improvising. ~80% of
   pilot issues map to a runbook.
3. **Run the runbook's Diagnosis section** verbatim. Copy outputs
   into the issue as a comment.
4. **Apply the runbook's Fix step** that matches the diagnostic.
5. **Verify resolution**: ask the affected user to retry, OR re-run
   the smoke (`scripts/smoke/<area>.sh`).
6. **Comment & close** the issue with: root cause, fix applied,
   verification proof, and (if relevant) a new entry for the
   runbook's "Linked Sentry fingerprints" section.
7. **If no runbook**: triage the issue, attach the fingerprint
   manually, and FILE A NEW RUNBOOK PR before closing. Anything
   that took >30 min to fix during pilot needs a runbook.

## Post-mortem template (every P0 incident)

Within 48h of any P0, the on-call who handled it files a post-mortem
PR at `Docs/post-mortems/YYYY-MM-DD-<slug>.md`:

```markdown
# Post-Mortem: <slug>

**Date:** YYYY-MM-DD
**Duration:** <ack> → <mitigation> → <full-resolution>
**Severity:** P0
**Authors:** @primary, @backup (if engaged)

## Summary

One paragraph: what broke, who saw it, how we fixed it.

## Timeline (EAT)

- HH:MM — First Sentry event
- HH:MM — Bridge filed GitHub Issue
- HH:MM — On-call ack
- HH:MM — Mitigation applied
- HH:MM — Full resolution confirmed

## Root cause

What actually broke and why. Distinguish from symptoms.

## What worked

- The bridge filed the issue in <X> seconds.
- The linked runbook (or: would have, if one existed) reduced MTTR.
- (etc.)

## What didn't work

- (etc.)

## Action items

- [ ] (owner, due date) — runbook update
- [ ] (owner, due date) — alert threshold change
- [ ] (owner, due date) — code fix
- [ ] (owner, due date) — pilot-comms note

## Pilot user impact

- Cohort: <name>
- Users affected: <n>
- Communication sent: yes / no — link to message.
```

## Out-of-pilot mode

When no pilot is active, only P0 pages out-of-hours. P1/P2 escalate
during business hours. This document is reviewed at the start of
every pilot cycle.

## See also

- [`services/consolidation-worker/src/tasks/sentry-to-github.ts`](../services/consolidation-worker/src/tasks/sentry-to-github.ts) — the bridge.
- [`Docs/runbooks/`](./runbooks/) — known-error runbooks.
- [`Docs/PILOT_RUNBOOK.md`](./PILOT_RUNBOOK.md) — pilot-execution playbook (Agent 10).
- [`scripts/triage/summarize-pilot-errors.ts`](../scripts/triage/summarize-pilot-errors.ts) — daily 1-screen summary.
- [`scripts/triage/auto-assign.ts`](../scripts/triage/auto-assign.ts) — issue-assignee suggester.
