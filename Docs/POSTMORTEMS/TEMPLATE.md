# Post-Mortem: <Short Title>

> Copy this file to `Docs/POSTMORTEMS/YYYY-MM-DD-<short-kebab-case-title>.md`
> where the date is the **start** of the incident in UTC. Fill in every
> section; if a section legitimately does not apply, replace its body with
> `N/A — <one-line reason>`. Do not delete sections.
>
> This template follows Anthropic's blameless 5-whys format. The goal is
> to fix the system, not the people. If your draft contains the word
> "should have" or names a colleague as a cause, rewrite it before review.

---

## Header

| Field | Value |
|---|---|
| **Incident ID** | INC-YYYY-NNN |
| **Severity** | P0 / P1 / P2 (+ DATA-INTEG / SEC-INC / REG-INC override if applicable) |
| **Start (UTC)** | YYYY-MM-DDTHH:MM:SSZ |
| **Detected (UTC)** | YYYY-MM-DDTHH:MM:SSZ |
| **Mitigated (UTC)** | YYYY-MM-DDTHH:MM:SSZ |
| **Resolved (UTC)** | YYYY-MM-DDTHH:MM:SSZ |
| **Total duration** | HH:MM (Start -> Resolved) |
| **Customer-visible duration** | HH:MM |
| **Author(s)** | name <email> |
| **Reviewers** | name, name, name |
| **Status** | DRAFT / IN_REVIEW / PUBLISHED |
| **Related** | links to other post-mortems, JIRA epics, PRs |

---

## 1. Summary

Two or three sentences a sleep-deprived stakeholder can read at 02:00 and
understand. What broke? Who was affected? How was it fixed? Save the
details for the rest of the document.

---

## 2. Impact

Quantified, not narrative.

- **Users affected**: <count, % of MAU, which tenants/regions>
- **Requests failed**: <count, % of normal>
- **Revenue impact**: <currency, range, methodology>
- **Data loss / corruption**: <bytes, rows, none>
- **SLA / SLO breach**: <which SLO, by how much; cross-link to `Docs/KPIS_AND_SLOS.md`>
- **Regulatory exposure**: <yes/no + which regulator if yes>
- **External communications**: <status page updates, customer emails, regulator filings>

---

## 3. Timeline

UTC timestamps. One row per material event. Include detection,
acknowledgement, mitigation attempts (failed and successful), comms, and
resolution.

| Time (UTC) | Event | Actor |
|---|---|---|
| 14:02 | Deploy of `api-gateway:abc1234` to prod | github-actions |
| 14:07 | Prometheus `p99_latency_ms > 5000` fires | alertmanager |
| 14:08 | Primary on-call acks page | on-call eng |
| 14:11 | `#incident-INC-2026-NNN` opened | on-call eng |
| 14:14 | Hypothesis: bad migration | on-call eng |
| 14:22 | Rolled back to `api-gateway:def5678` | on-call eng |
| 14:24 | p99 returns to baseline | prometheus |
| 14:30 | Status page updated to "resolved" | on-call eng |

---

## 4. Root Cause — 5 Whys

State the root cause in one sentence, then walk down the 5-whys ladder.
Stop when the next "why" would be "because humans are fallible" — that's
the floor. The point is to find the systemic gap, not to interrogate.

**Root cause (one sentence)**: <one sentence>

**5-whys ladder**:

1. **Why did <symptom> happen?**
   - Because <direct cause>.
2. **Why did <direct cause> happen?**
   - Because <next-level cause>.
3. **Why did <next-level cause> happen?**
   - Because <next-level cause>.
4. **Why did <next-level cause> happen?**
   - Because <next-level cause>.
5. **Why did <next-level cause> happen?**
   - Because <systemic gap> — this is the layer where the action items live.

If the chain bottoms out before five rungs, write "N/A — chain terminates
at rung N" and explain why rung N+1 is not actionable. If it requires
more than five, add rungs — five is the floor, not the ceiling.

---

## 5. Contributing Factors

Not root cause, but made the incident worse or harder to detect / mitigate.
List each with severity (low / medium / high) and whether it has an
action item.

- **Factor 1**: <description>. Severity: <l/m/h>. Action item: <AI-N or none>.
- **Factor 2**: <description>. Severity: <l/m/h>. Action item: <AI-N or none>.

---

## 6. What Went Well

Equally important as what went wrong. Captures the resilience patterns
that should be preserved (and noticed by future on-call). Bullet points.

- Detection time was X min, well inside our 5-min budget.
- Rollback playbook in `Docs/RUNBOOK.md §rollback` worked exactly as written.
- Customer comms went out within Y min via the status page.

---

## 7. What Went Poorly

The honest version. Bullet points; tie each one to an action item if it
points at something repairable.

- Alert fired but routed to the wrong service — see AI-1.
- Rollback required manual `kubectl` commands not in the runbook — see AI-2.
- Status page update was delayed Z min because no one had the password — see AI-3.

---

## 8. Action Items

Every action item MUST have an owner, a deadline, and a JIRA / GitHub
issue link. "Be more careful next time" is not an action item.

| ID | Description | Owner | Due | Status | Issue |
|---|---|---|---|---|---|
| AI-1 | <action> | name | YYYY-MM-DD | TODO / IN_PROGRESS / DONE | [#NNN](https://github.com/...) |
| AI-2 | <action> | name | YYYY-MM-DD | TODO / IN_PROGRESS / DONE | [#NNN](https://github.com/...) |
| AI-3 | <action> | name | YYYY-MM-DD | TODO / IN_PROGRESS / DONE | [#NNN](https://github.com/...) |

Aim for at least one action item targeting **detection**, one targeting
**mitigation**, and one targeting **prevention**. If you can't find a
prevention action item, the 5-whys ladder did not go deep enough.

---

## 9. Lessons (institutional memory)

The 2–4 things future-you would want to know reading this in two years.
Write them as crisp statements, not paragraphs. Example:

- **Prefer feature flags over deploy-time toggles** — every config-only
  rollback in this incident took longer than a deploy rollback would have.
- **Migration timing matters** — running schema changes during the
  Tanzania month-end window magnified blast radius; the freeze window in
  `Docs/RUNBOOK.md` exists for a reason.
- **Status page muscle memory** — operators who haven't updated the page
  in 90 days forget the workflow; rotate this in tabletop drills.

---

## 10. Appendices

- **A. Relevant logs / traces**: <link to Loki / Sentry / S3 archive>
- **B. Dashboards at time of incident**: <Grafana snapshot URLs>
- **C. PRs / commits referenced**: <link list>
- **D. Customer comms verbatim**: <copy of emails, status updates>
- **E. Internal Slack transcript**: <link to `#incident-INC-2026-NNN` export>

---

_Drafted: YYYY-MM-DD by <author>. Reviewed: YYYY-MM-DD by <reviewers>.
Published: YYYY-MM-DD._
