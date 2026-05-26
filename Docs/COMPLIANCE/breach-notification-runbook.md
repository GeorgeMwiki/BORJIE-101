# Breach Notification Runbook — 72-Hour Flow

_Applies to: GDPR Art. 33/34, PDPA TZ s. 28, DPA KE s. 43, NDPA NG s. 40._

All four statutes converge on a **72-hour notification window**. This runbook
is the on-call commander's playbook.

## T+0 to T+1h — Detection & triage

**Trigger sources** (any of):
- Alert from Prometheus rule `BreachIndicator` (see `infra/observability/alerts/`)
- Manual report (engineer, customer support)
- External report (security researcher, regulator)
- Audit-log anomaly (`audit_events` rate spike + unauthorised access pattern)

**On-call SRE actions**:
1. Acknowledge the page within 5 min
2. Capture initial evidence — DO NOT touch the affected system yet:
   - Snapshot logs, metrics, traces (kept for forensics)
   - Note timestamp (T+0) in incident channel `#sev1-<INCIDENT_ID>`
3. **Start the 72-hour clock** the moment "awareness" is reached. Awareness =
   reasonable confidence a breach has occurred, not formal confirmation.
4. Page L2 security incident commander (IC): `<SECURITY_PAGER>`

## T+1h to T+4h — Containment & assessment

**Security IC actions**:
1. Convene war-room (engineering lead + DPO + legal + comms)
2. Contain — revoke compromised credentials, isolate hosts, block IPs at WAF
3. Preserve — write-protect logs, snapshot DBs, pull S3 access trails
4. **Initial scope assessment**:
   - Number of data subjects affected (approximate band — 1, 10, 100, 1k, 10k+)
   - Categories of personal data exposed
   - Jurisdictions affected (TZ / KE / NG / EU / other)
   - Likelihood of harm (low / medium / high)

The "high risk" determination drives whether subject notification is required
(GDPR Art. 34, NDPA s. 40(3)) on top of regulator notification.

## T+4h to T+24h — Investigation & impact analysis

**Engineering + Security**:
- Root-cause analysis
- Lateral-movement check (was access limited to the discovered scope?)
- Data exfiltration confirmation via egress traffic analysis
- Identify EVERY data class touched (use `data-classification.ts` mapping)
- Determine which audit_events rows the actor accessed

**DPO**:
- Confirm jurisdictions and tally affected data subjects per jurisdiction
- Draft notification per jurisdiction's template (use the jurisdiction runbooks)
- Decide subject-notification strategy (channel, language, message)

## T+24h to T+72h — Notification

For **each** jurisdiction with affected subjects:

### TZ — PDPC

- Template: see [PDPA-tz-runbook.md § 6](./PDPA-tz-runbook.md)
- Channel: PDPC portal `https://pdpc.go.tz/file-complaint` + email `<PDPC_EMAIL>`
- Filed by: DPO `<DPO_CONTACT>`

### KE — ODPC

- Template: see [DPA-ke-runbook.md § 6](./DPA-ke-runbook.md)
- Channel: ODPC portal `https://www.odpc.go.ke/complaint`
- Filed by: DPO `<DPO_CONTACT>`

### NG — NDPC

- Template: see [NDPA-ng-runbook.md § 6](./NDPA-ng-runbook.md)
- Channel: NDPC portal `https://ndpc.gov.ng/complaints`
- Filed by: DPCO `<DPCO_CONTACT>`

### EU — Lead Supervisory Authority

- Template: see [GDPR-eu-runbook.md § 6](./GDPR-eu-runbook.md)
- Channel: `<LSA_PORTAL>`
- Filed by: DPO + EU Representative `<EU_REP_CONTACT>`
- One-stop-shop rule (Art. 56) — file with lead authority, who relays to others

### Subject notification (when "high risk")

Email + SMS + push to affected subjects, in their preferred language
(Swahili, English). Template:

```
Subject: Important security notice about your BORJIE account

Dear <FIRST_NAME>,

On <DATE> we detected unauthorised access to a system that holds some
of your personal information. We have completed our investigation and want
to let you know exactly what happened.

What happened:
<one-paragraph plain-language description>

What information was involved:
<list the data classes — e.g., "your name, phone number, and email address.
No passwords, payment details, or NIDA / KRA-PIN numbers were affected">

What we are doing:
- We patched the issue on <DATE>
- We have notified the <REGULATOR_NAME>
- We are continuing to monitor and improve our defences

What you can do:
- Watch for suspicious calls / messages claiming to be from BORJIE
- If anything looks wrong, contact us at <SUPPORT_CHANNEL>

You have the right to lodge a complaint with the <REGULATOR_NAME>
(<REGULATOR_CONTACT>) if you are dissatisfied with how we handled this.

We are sorry this happened.

— The BORJIE team
Incident reference: <INCIDENT_ID>
```

## Post-notification — T+72h to T+30d

1. **Closure report** to each regulator (typically requested 14–30 days later)
2. **Sovereign-action-ledger** entries for every notification sent (hash chain
   anchors the immutable record)
3. **Lessons-learned review** within 14 days
4. **Process improvements** filed as roadmap items
5. **External post-mortem** published if appropriate (transparency aids trust)

## When the breach is below threshold

NOT every incident requires notification. A "personal data breach" must be
"likely to result in a risk to the rights and freedoms of natural persons"
(GDPR Art. 33(1) analogues).

If the incident:
- Affected only encrypted data + the keys were not compromised, OR
- Affected only non-PII operational data, OR
- Was a near-miss (no actual unauthorised access)

Document the decision **NOT** to notify in the sovereign-action-ledger with
the IC's signed rationale. The regulator can still review this audit trail
on inspection.

## Escalation table

| Severity | Definition | Owner | First page |
|---|---|---|---|
| SEV-1 | Confirmed PII exfiltration ≥100 subjects | Security IC | <SECURITY_PAGER> |
| SEV-2 | Suspected exfiltration / smaller scope | Security IC | <SECURITY_PAGER> |
| SEV-3 | Internal exposure (over-broad IAM, etc.) | Eng lead | <ENG_PAGER> |
| SEV-4 | Process violation (e.g., DPA breach in agreement) | DPO | <DPO_CONTACT> |

## Drills

Quarterly: run a simulated SEV-1 breach exercise. Verify:
- Time-to-acknowledge < 15 min
- Time-to-first-notification < 48h (giving 24h buffer)
- All regulator templates render with current jurisdictional rules
- Subject-notification email infrastructure routes correctly

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
