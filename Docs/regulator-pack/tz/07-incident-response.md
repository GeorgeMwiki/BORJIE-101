# 07 — Incident Response Plan (Tanzania)

**Document version:** 1.0
**Date:** 2026-05-22
**Owner:** CISO
**Jurisdiction:** Tanzania
**Plan tier:** P0–P3 with 24-hour regulator notification SLA
**Aligned to:** NIST SP 800-61r2 Computer Security Incident Handling Guide; ISO/IEC 27035; BoT BCM Guidelines 2021 §13 (Crisis Management Team); PDPA s.45 (breach notification).

---

## 1. Scope

This plan covers all incidents that affect Borjie's confidentiality, integrity or availability of tenant, property, lease, or financial data, including: data breaches, account takeover, insider misuse, vendor compromise, ransomware, application outages, payment-rail failures, model failures producing biased outputs, voice-agent hallucination at material scale, and AI-prompt-injection incidents.

## 2. Severity definitions

| Severity | Examples | First-page SLA | Resolution SLA |
|---|---|---|---|
| **P0 — Critical** | Confirmed breach of tenant PII or financial data; ransomware on production; unauthorised rent disbursement; total platform outage > 15 min; hash-chain audit-trail tamper detected; mass mis-charge on rent collection | ≤ 5 min | ≤ 4 h to mitigation |
| **P1 — High** | Suspected breach; partial outage of payments API; sub-processor confirmed breach; AI voice agent producing high-confidence wrong answers at material scale; any P0-class condition affecting < 100 tenants | ≤ 15 min | ≤ 24 h |
| **P2 — Medium** | Localised feature outage; degraded latency > 2× SLA; isolated model-fairness violation; M-Pesa STK callback errors > 1% for > 1 hour | ≤ 1 h (business hours) | ≤ 5 business days |
| **P3 — Low** | Minor functional bug; user-experience degradation; non-prod incident with prod implications | Same business day | ≤ 30 days or planned release |

P0 / P1 always escalate to the CISO and CRO. P0 also escalates to the CEO and Board chair within 1 hour of confirmation.

## 3. Crisis Management / Incident Response Team

Per BoT BCM Guidelines 2021 §13(e)–(f), Borjie maintains a Crisis Management Team / Incident Response Team (IRT).

| Role on IRT | Holder (default) | Responsibility |
|---|---|---|
| Incident Commander | CISO (deputy: Head of Eng) | Owns incident; decides severity; runs war room |
| Operations Lead | Head of SRE / Eng on-call | Technical mitigation and recovery |
| Communications Lead | Head of Marketing + Comms | Internal, customer, regulator, press communication |
| Compliance Lead | CCO + (DPO when PII involved, MLRO when payments-related) | Regulator notification, legal, evidence preservation |
| Risk Lead | CRO | Business-impact assessment, Board liaison |
| Customer Lead | Head of Customer Success | Affected customer (property-owner / tenant) outreach |
| Forensics Lead | External retained DFIR firm | Engaged on P0 within 1 h |

### 3.1 Roles and responsibilities

- **Incident Commander** has authority to: page anyone, take systems offline, engage external counsel and DFIR, authorise regulator notification, and toggle kill-switches on production AI agents.
- The IRT operates on a 24/7 on-call rotation. Primary on-call has 5-minute paging response; secondary has 15-minute.
- All decisions during an incident are logged in the war-room channel and archived as evidence (doc 10).

## 4. Detection sources

| Source | Implementation |
|---|---|
| Automated anomaly detection | TODO — 7-rule detector (impossible travel, login spike, role escalation, mass DSAR query, exfil pattern, brute force, service-role-key usage from new IP) |
| Hash-chain integrity | Read-time tail check + 24-h full sampling cron |
| Application monitoring | Vercel + Supabase metrics; latency / error-rate SLOs in `Docs/KPIS_AND_SLOS.md` |
| Customer reports | support@borjie.com routed to on-call within 15 min if security-tagged |
| Vendor notifications | Anthropic / OpenAI / Supabase / Vercel / MNO breach notification clauses |
| MNO callback monitoring | M-Pesa / Airtel / TigoPesa / HaloPesa callback success-rate dashboards |
| Public threat intelligence | TZ-CERT (planned), commercial threat-intel feed |
| Pen-test findings | Annual third-party pentest |

Call-tree testing is performed monthly (per BoT BCM §17 (f)).

## 5. Regulator notification SLAs

| Regulator / Body | Trigger | Notification SLA |
|---|---|---|
| Personal Data Protection Commission (PDPC) | Personal-data breach likely to result in risk to data-subject rights (PDPA s.45) | **≤ 24 h** internal target (statutory: 72 h) |
| Bank of Tanzania (BoT) | Material incident affecting rent-collection rail or institutional landlord operations | **≤ 24 h** (commitment to partner banks / institutional clients exceeding supervisory expectation) |
| Tanzania Revenue Authority (TRA) | Incident causing TRA reporting feed to fail > 24 h | Per TRA technical-integration agreement |
| TCRA | Voice / SMS service incident | Per TCRA notification rules |
| TZ-CERT (when registered) | Cybersecurity incident with sector implications | Per CERT MOU |
| MNO partners (Vodacom / Airtel / Tigo / Halotel) | Any incident affecting payment-rail integration | **≤ 1 h** (contractual) |
| Institutional landlord clients (NHC, pension funds, DFIs) | Any incident with their tenant or financial data exposed | **≤ 1 h** (contractual) |
| Affected data subjects (tenants) | High-risk PII breach (PDPA s.45) | **≤ 72 h** |

## 6. Response phases (NIST 800-61r2)

### 6.1 Preparation

- Annual tabletop exercise (full IRT)
- Quarterly drill (specific scenario)
- Runbook library (`Docs/RUNBOOKS/`): incident-response, killswitch, encryption rotation, RTBF, cron debug
- Pre-drafted communications templates (regulator, customer, internal, press)
- Pre-engaged DFIR retainer (firm + 2× backup)

### 6.2 Detection & analysis

- IRT triages; Incident Commander declares severity
- War room opened (Slack / Discord); decision log started
- Forensic snapshot taken before any remediation that would destroy evidence

### 6.3 Containment, eradication, recovery

- Containment: kill-switches, rate-limit clamp, tenant-scoped isolation, service degradation
- Eradication: patch, rotate secrets, remove malicious artefact
- Recovery: restore service per RTO / RPO (doc 08)

### 6.4 Post-incident

- 5-whys / blameless post-mortem within 5 business days
- Post-mortem stored at `Docs/POSTMORTEMS/` (existing folder)
- Action items tracked to closure
- Regulator follow-up report if requested

## 7. Crisis comms templates

> TODO: insert pre-drafted templates for: tenant breach notification (sw / en), property-owner notification, PDPC notification, BoT / institutional-client notification, press statement (placeholder + draft + final).

## 8. AI-incident-specific playbook

| AI-incident type | First action (path:line) |
|---|---|
| Voice-agent hallucination at scale | Kill-switch via `services/api-gateway/src/composition/voice-agent-wiring.ts` (fan-out broadcast through `cross-portal-killswitch-fanout.ts`); revert to human-routed; notify affected tenants if hallucination caused material outcome |
| Predictive-interventions false-positive surge | Kill-switch at `services/api-gateway/src/composition/predictive-interventions-wiring.ts`; freeze auto-triggered communications; manual review queue surfaced through `services/api-gateway/src/routes/approvals.router.ts` |
| Prompt injection succeeds in invoking tool | Rotate affected creds; review tool ACL in `packages/central-intelligence/src/policy-gate/tier-policy-resolver.ts`; tighten intent verifier in `packages/ai-copilot/src/security/prompt-shield.ts`; audit recent tool calls against `packages/database/src/schemas/sovereign-action-ledger.schema.ts` |
| Model drift > threshold | Auto-rollback to last-known-good champion via Mission-Eval; Model Risk Committee review against doc 05 §3 lifecycle gates |
| Hash-chain tamper detected | Page CISO immediately; freeze writes to affected module; full `verifyRandomSample` over the suspect chain (`packages/ai-copilot/src/security/audit-hash-chain.ts`, 651 lines) before restoring service |

## 9. Cross-references

- BCM / DR runbooks → doc 08
- Audit-trail evidence preservation → doc 10
- Existing post-mortem index → `Docs/POSTMORTEMS/`

## 10. On-call + paging

| Resource | URL placeholder |
|---|---|
| PagerDuty — primary on-call rotation | `https://borjie.pagerduty.com/schedules/PR-PRIMARY-001` |
| PagerDuty — secondary on-call rotation | `https://borjie.pagerduty.com/schedules/PR-SECONDARY-001` |
| PagerDuty — CISO escalation policy | `https://borjie.pagerduty.com/escalation_policies/EP-CISO-001` |
| Statuspage — public outage banner | `https://status.borjie.com/admin/manage` |
| Slack — `#incident-warroom` channel | `https://borjie.slack.com/archives/C-INCIDENT-WARROOM` |
| Grafana — alert overview | `https://grafana.borjie.com/alerting/list` |

---

## Appendix A — Board Sign-Off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| CISO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/ciso/regulator-pack-tz-07-v1.0` |
| CTO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cto/regulator-pack-tz-07-v1.0` |
| CRO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cro/regulator-pack-tz-07-v1.0` |
| Head of Comms | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/comms/regulator-pack-tz-07-v1.0` |
| CEO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/ceo/regulator-pack-tz-07-v1.0` |

## Appendix B — Version History

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial scaffold | CISO |
| 1.1.0 | 2026-05-22 | AI-incident playbook code refs + on-call + dashboard placeholders (Wave-12) | CISO |

## Appendix C — Review Cadence

- **Annual** — full IRT tabletop + plan review
- **Quarterly** — scenario drill + after-action update
- **Out-of-cycle** — every P0/P1 incident; CISO triggers plan refresh within 30 days
- **Monthly** — on-call rotation + call-tree test
