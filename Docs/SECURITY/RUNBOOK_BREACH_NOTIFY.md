# Runbook — Personal Data Breach Notification (PDPA s.51)

**Audience:** on-call SEC engineer, DPO, executive leadership, PCCB
liaison.
**Statutes:**
- Tanzania Personal Data Protection Act 2022 (PDPA) s.51 — controller
  must notify the Commission within **72 hours** of becoming aware of
  a personal-data breach. Notification to affected data subjects is
  separately required without undue delay if the breach is "likely to
  result in significant harm".
- Kenya Data Protection Act 2019 s.43 — same 72-hour clock.
- Uganda Data Protection and Privacy Act 2019 s.23 — same 72-hour clock.
- Nigeria Data Protection Act 2023 s.40 — 72 hours.
- EU GDPR Art. 33 — 72 hours.
- South Africa POPIA — "as soon as reasonably possible".
**Companion docs:**
- [`Docs/SECURITY/SECURITY_AUDIT_2026-05-29.md`](./SECURITY_AUDIT_2026-05-29.md) §5 (S-5 PCCB/PDPA)
- [`Docs/SECURITY/PCCB_PDPA_AUDIT_2026-05-29.md`](./PCCB_PDPA_AUDIT_2026-05-29.md) §6 (pre-launch sign-off)
- [`Docs/SECURITY/THREAT_MODEL_2026.md`](./THREAT_MODEL_2026.md) §7
- [`Docs/SECURITY/SOTA_SECURITY_POSTURE_2026.md`](./SOTA_SECURITY_POSTURE_2026.md) §6
- [`Docs/SECURITY/DATA_RESIDENCY_PHASE_1.md`](./DATA_RESIDENCY_PHASE_1.md)
- [`Docs/AUDIT/SCALE_RUNBOOK.md`](../AUDIT/SCALE_RUNBOOK.md)

**Status:** GREEN. Runbook in force as of 2026-05-29. Annual review
cadence; next review 2027-05-29.

---

## 1. 72-hour clock — start, pause, stop

**Start.** The clock starts when **Borjie becomes aware** of a personal-
data breach. "Aware" means a single named SEC engineer or DPO has a
high-confidence belief that personal data has been compromised. Mere
detection of an anomaly is NOT awareness; investigation that confirms
compromise IS.

**Pause.** Per PDPA s.51(4) and GDPR Art. 33(4), the controller may
withhold notification details that cannot be known yet, and provide
them "in phases without undue further delay." The clock does not pause
overall, but the first notification can be partial.

**Stop.** When all four mandatory fields below are filed with PCCB
(or KE / UG / NG equivalent) and acknowledged.

The on-call SEC engineer **starts a timer in the security-events
channel** the moment they accept the incident.

---

## 2. Severity matrix (decide first; everything else follows)

| Severity | Triggers | Notification scope |
|----------|----------|--------------------|
| **CRITICAL** | PII of >100 data subjects exfiltrated OR financial / biometric / location data of any data subject exfiltrated OR breach is ongoing | PCCB within 72h + data subjects within 72h + status page update + tenant in-app banner |
| **HIGH** | PII of any data subject exfiltrated OR PII access without authorisation by a Borjie employee | PCCB within 72h + tenant DPO notified within 24h |
| **MEDIUM** | Cross-tenant denial pattern (e.g. 10+ TENANT_MISMATCH from same actor in 1 hour) OR successful CSRF / XSS / SSRF that touched (but did not exfiltrate) PII | PCCB within 72h + internal post-mortem |
| **LOW** | Operational anomaly with no confirmed PII access; near-miss; failed attempt | Internal post-mortem only |

The on-call SEC engineer chooses the severity within 15 minutes of
awareness. The DPO can upgrade (never downgrade) the severity at any
time.

---

## 3. Detection — how Borjie learns it is breached

In priority order:

1. **`crossOrgDenialRecorder` alert** — pattern scanner emits a
   security-event when an actor accumulates more than the threshold
   number of `TENANT_MISMATCH` denials. Wired in
   `services/api-gateway/src/middleware/tenant-context.middleware.ts`.
2. **Sentry alert** — production exception rule fires on any error
   tagged `security`, `auth`, or `pii`. Routes to PagerDuty.
3. **Audit-chain anomaly** — hash-chain trigger refuses an
   UPDATE / DELETE, raising `AUDIT_CHAIN_TAMPERED` 500. Pino logs
   this at `fatal`; PagerDuty rule is `level:fatal`.
4. **Rate-limit Redis fallback** — `rate-limit-redis.middleware.ts`
   Sentry capture fires when the cap silently degrades; long
   degradation windows can allow brute-force. See `Docs/AUDIT/SCALE_RUNBOOK.md`.
5. **External report** — `security@borjie.co.tz` mailbox monitored
   24/7 by the SEC on-call rotation.
6. **Third-party disclosure** — vulnerability report from a vendor
   (Supabase, AWS, Anthropic, etc.) via their security-disclosure
   channel.

---

## 4. Containment — first 60 minutes

Once awareness is declared:

1. **Flip the kill-switch** — pull the `kill_switch_open` flag on the
   affected tenant(s). See
   `packages/central-intelligence/src/kernel/policy-gate.ts` and the
   `kill-switch.middleware.ts`. The flag stops every WRITE through the
   persona-tool gate and every brain tool dispatch.
2. **Revoke the compromised credential**, if any. Rotate via
   `services/api-gateway/src/auth/key-rotator.ts` for service keys;
   force-logout via `POST /api/v1/admin/sessions/revoke-all` for user
   sessions.
3. **Block the source IP / actor**, if attribution is high-confidence.
4. **Snapshot evidence.** Capture the relevant audit-chain rows
   (`ai_audit_chain WHERE tenant_id=? AND occurred_at BETWEEN ?` and
   `?`), the cross-org denial rows, the relevant Sentry events, the
   relevant Pino logs (search by `requestId` or `tenantId`).
5. **Page the DPO + Borjie executive** — page sequence: SEC on-call →
   DPO → CEO. Pages must be acknowledged within 30 minutes.

The 60-minute containment-window timer is a hard SLO; failure pages
the next layer up automatically.

---

## 5. Investigation — first 24 hours

The investigation produces a Breach Assessment Document with these
fields:

| Field | Source | Required for first PCCB notification? |
|-------|--------|--------------------------------------|
| Date / time of breach | `ai_audit_chain.occurred_at` | yes |
| Date / time Borjie became aware | runbook timer | yes |
| Nature of breach | DPO synthesis from evidence | yes |
| Categories of personal data | RoPA cross-reference (see DPA Annex A) | yes |
| Approximate number of data subjects | DB count query | yes |
| Approximate number of records | DB count query | yes |
| Likely consequences | DPO assessment | yes |
| Measures taken or proposed | Containment log | yes (proposed acceptable in phase 1) |
| DPO name + contact | static | yes |

The first PCCB notification can omit "Likely consequences" and
"Measures taken" if they are still being assessed, but the controller
must commit to providing them in a follow-up.

---

## 6. PCCB notification — exact filing procedure

### 6.1 Channel

Per PCCB Guideline 4/2025 §11, breach notifications are filed via:

- **Primary:** the PCCB online portal at
  <https://www.pdpc.go.tz/breach-notify> (HTTPS form).
- **Backup (if portal down):** email to `breach-notify@pdpc.go.tz`
  with the breach-notification template attached as PDF.
- **In-person backup:** PCCB office at Mwalimu Nyerere Memorial
  Academy, Bagamoyo Road, Dar es Salaam — drop physical copy with
  the duty officer; obtain receipt stamp.

### 6.2 Filing template

Borjie standard breach-notification PDF template lives at
`Docs/SECURITY/templates/breach-notification-pccb.pdf` (operator-
internal; the source is `breach-notification-pccb.md` rendered via
pandoc per release pipeline). The template implements every PDPA s.51
field plus the PCCB-specific structured fields from Guideline 4/2025.

### 6.3 Receipt

Capture the receipt number into the central register at the operator-
internal location `services/api-gateway/src/composition/breach-
register.ts`. The hash-chained audit ledger gets an
`action='breach_notify_filed'` entry with the receipt number as the
payload.

### 6.4 Multi-jurisdiction filings

If affected data subjects span multiple jurisdictions:

| Jurisdiction | Authority | Channel |
|--------------|-----------|---------|
| Tanzania | PCCB | <https://www.pdpc.go.tz/breach-notify> |
| Kenya | ODPC | <https://www.odpc.go.ke/?p=breach> |
| Uganda | PDPO | <https://nita.go.ug/data-protection> |
| Nigeria | NDPC | <https://ndpc.gov.ng> |
| South Africa | IR | <https://inforegulator.org.za> |
| EU | lead supervisory authority | per controller's main establishment |

Each filing is independent; the 72-hour clock applies to each.

---

## 7. Data-subject notification (CRITICAL severity only)

When >100 data subjects' PII was exfiltrated OR any data subject's
financial / biometric / location data was exfiltrated, Borjie notifies
each affected data subject individually.

### 7.1 Channels (multi-redundant)

1. **Bilingual sw/en in-app banner** on owner-web / workforce-mobile
   / buyer-mobile, pinned at the top of every screen for the
   affected tenant(s) for 30 days.
2. **SMS** to the data subject's recorded mobile phone, sent via the
   existing notifications service (`@borjie/notifications-service`).
   SMS body is bilingual sw/en, ≤160 chars.
3. **Email** to the data subject's recorded email address, sent via
   the resend adapter at `packages/notifications-service/src/
   providers/resend-adapter.ts`.
4. **Public status-page update** at `https://status.borjie.com`.

### 7.2 Notification template (English)

> Subject: Important: data security incident notification
>
> Borjie has identified a security incident affecting your data on
> [date]. The data potentially involved: [categories]. The likely
> consequences for you: [consequences]. We have taken the following
> steps: [actions]. We recommend you: [actions for the subject].
>
> For more information or to exercise your rights, contact
> dpo@borjie.co.tz or visit https://borjie.co.tz/legal/breach-notice.
>
> We sincerely apologise for this incident. — Borjie DPO

### 7.3 Notification template (Swahili)

> Mada: Muhimu: tangazo la tukio la usalama wa data
>
> Borjie imegundua tukio la usalama linaloathiri data yako tarehe
> [tarehe]. Aina ya data: [aina]. Matokeo yanayowezekana: [matokeo].
> Hatua tulizochukua: [hatua]. Tunapendekeza ufanye: [hatua za
> mhusika].
>
> Kwa maelezo zaidi au kutumia haki zako, wasiliana na
> dpo@borjie.co.tz au tembelea
> https://borjie.co.tz/legal/breach-notice.
>
> Tunaomba radhi sana kwa tukio hili. — Borjie DPO

---

## 8. Post-mortem — first 7 days

Within 7 days of breach awareness, the SEC team publishes an internal
post-mortem to the security-events channel + the Borjie engineering
all-hands. The post-mortem covers:

- Timeline (awareness → containment → notification → remediation).
- Root cause (5-whys).
- Detection gap (could we have caught this earlier?).
- Process improvement (runbook updates).
- Code fixes (PRs landed during remediation).
- Lessons learned for the threat model
  (`Docs/SECURITY/THREAT_MODEL_2026.md`).

The post-mortem is blameless. The goal is a stronger defence, not
attribution.

---

## 9. Quarterly tabletop exercise

Every quarter the SEC team runs a tabletop breach simulation:

1. SEC lead invents a plausible breach scenario (e.g. compromised
   Supabase API key, leaked operator laptop, malicious insider).
2. On-call team walks through the runbook against a stopwatch.
3. Findings are added to the runbook as line-item improvements.
4. The next-quarter tabletop scenario must be different from the
   previous three.

The first tabletop is scheduled for 2026-08-01 (Q3 2026).

---

## 10. Contacts

| Role | Name | Phone | Email |
|------|------|-------|-------|
| Borjie DPO | Mr. Mwikila | _______________ | `dpo@borjie.co.tz` |
| Borjie CEO | _______________ | _______________ | `ceo@borjie.co.tz` |
| PCCB duty officer | (rotating) | +255 (0) 22 211 0240 | `breach-notify@pdpc.go.tz` |
| Supabase security | n/a | n/a | `security@supabase.com` |
| AWS security | n/a | n/a | `aws-security@amazon.com` |
| External counsel | _______________ | _______________ | _______________ |
| Insurance (cyber) | _______________ | _______________ | _______________ |

(The phone / email slots are filled by the on-call binder at
operator-internal location; this doc is the public-ish runbook.)

---

## 11. Sign-off

| Run | Date | Result | Reviewer |
|-----|------|--------|----------|
| Initial publication | 2026-05-29 | GREEN — runbook in force, tabletop scheduled | SEC-1 (Mr. Mwikila) |

End of breach-notification runbook.
