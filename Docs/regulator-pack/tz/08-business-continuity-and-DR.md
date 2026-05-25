# 08 — Business Continuity and Disaster Recovery (Tanzania)

**Document version:** 1.0
**Date:** 2026-05-22
**Owner:** CISO + CTO
**Jurisdiction:** Tanzania
**Aligned to:** BoT Business Continuity Management Guidelines, 2021 (§13–§18); ISO 22301 Business Continuity Management; NIST SP 800-34r1 Contingency Planning Guide.

---

## 1. Mission-critical activities (MCAs)

Per BoT BCM Guidelines 2021 §16(vi), an institution must define RTO and RPO for every Mission Critical Activity. Borjie's MCAs:

| MCA | Description | Tier | RTO | RPO |
|---|---|---|---|---|
| **MCA-01 — Authentication** | Tenant / property-mgr / owner / internal-ops login + session validation (Supabase Auth) | T1 | **30 min** | **5 min** |
| **MCA-02 — Rent-collection rail** | M-Pesa STK, Airtel STK, TigoPesa, HaloPesa, GePG inbound webhooks + ledger writes | T1 | **2 h** | **15 min** |
| **MCA-03 — Audit chain** | Hash-chain audit log writes + integrity verification | T1 | **30 min** | **0 min** (must be lossless) |
| **MCA-04 — Tenant identity (NIDA + Smile)** | KYC during onboarding | T2 | **4 h** | **1 h** |
| **MCA-05 — Voice / WhatsApp / SMS** | Voice agent, tenant communication channels | T2 | **4 h** | **1 h** |
| **MCA-06 — Customer app** | Tenant self-service (rent, maintenance, documents, communication) | T2 | **4 h** | **1 h** |
| **MCA-07 — Estate-manager app** | Property-manager workbench | T2 | **4 h** | **1 h** |
| **MCA-08 — Owner portal** | Portfolio dashboards, reports | T3 | **24 h** | **24 h** |
| **MCA-09 — Marketing site** | Public website | T3 | **24 h** | **24 h** |
| **MCA-10 — Reporting / analytics** | Periodic reports, TRA disclosure feeds | T3 | **24 h** | **24 h** |

T1 = always-on; T2 = same-day; T3 = next-day. RTO is measured from declaration of incident to first-byte service restored.

## 2. Threat scenarios covered

| Scenario | Impact | Plan |
|---|---|---|
| Vercel region (fra1) outage | Frontend + API unreachable | Failover to bom1 standby (DNS / edge) |
| Supabase primary DB outage | Database unreachable | PITR restore + read-replica promotion |
| Supabase region-wide outage | Region failure | Cross-region read replica promote + DNS cutover |
| Cloudflare outage | Edge / DNS / WAF degradation | Origin-direct fallback; documented IP allow-list |
| Anthropic / OpenAI API outage | AI components unavailable | Multi-provider routing; rule-based degrade-mode for voice agent |
| **M-Pesa Tanzania outage** | Largest rent rail unavailable | Auto-route to Airtel / TigoPesa / HaloPesa; tenant notified; manual reconciliation runbook |
| Airtel / Tigo / Halo outage | Secondary MNO unavailable | Other MNOs continue; status banner in customer app |
| GePG outage | Government-payments rail unavailable | Status banner; manual payment instructions |
| ElevenLabs outage | Voice agent voice unavailable | Twilio TTS fallback; SMS / WhatsApp text mode |
| Africa's Talking outage | TZ-local SMS / USSD down | Twilio fallback |
| Stripe outage (limited use — international cards) | Not material for TZ-resident tenants | N/A |
| DDoS attack | Edge saturation | Cloudflare DDoS mitigation; rate-limit; Argo |
| Ransomware | Encrypted data | Daily backups + PITR; immutable bucket; isolated key escrow |
| Insider data exfiltration | PII outflow | RBAC + DLP + anomaly detection; IRT engaged |
| Loss of key personnel | Operational gap | Documented runbooks; cross-training; deputy designations |
| Office-network outage | Staff unable to work | Distributed workforce; cellular failover; alternate work locations |

## 3. RTO / RPO design

### 3.1 RPO controls

- **Postgres WAL streaming** to Supabase replicas — replication lag SLO < 5 min
- **Daily logical backups** (`pg_dump`) to encrypted off-region object storage with 7-day PITR
- **Audit-chain table** is `WAL`-replicated synchronously; configured RPO = 0
- **Payments ledger outbox** is durable; webhook idempotency means no double-credit even on replay
- **Object storage** (documents, voice clips, ID images) cross-region replicated; lifecycle policy 1-year warm + archive

### 3.2 RTO controls

- **Multi-region active-passive**: Vercel fra1 primary, bom1 standby; failover via DNS in < 10 min
- **Database promotion**: documented runbook `Docs/RUNBOOKS/dr-failover.md` (TODO)
- **Edge configuration**: pre-staged in standby region; DNS TTL 60 s
- **Postgres HA + Redis Sentinel** configs already in production compose (see `Docs/MODULAR_MONOLITH.md`)

## 4. Alternate site (BoT BCM §17)

Per BoT BCM Guidelines §17, an alternate recovery site must be sufficiently remote from primary, have current data, and include backup power and connectivity.

Borjie's "alternate site" is delivered through cloud multi-region:

- **Primary:** Vercel + Supabase, region `fra1` (Frankfurt, Germany)
- **Standby:** Vercel `bom1` (Mumbai, India) for compute; Supabase cross-region read-replica
- **Backup:** Encrypted object-storage in third region for backups (cold tier)

Geographic distance is sufficient for a regional natural disaster or outage. Roadmap: A Tanzania-resident standby once a compliant local DC vendor is operational.

## 5. Backup strategy

| Asset | Method | Frequency | Retention | Encryption |
|---|---|---|---|---|
| Postgres | WAL + nightly `pg_dump` | Continuous + nightly | 7-day PITR + 30-day cold | AES-256 |
| Object storage (docs, voice, images) | Cross-region replication | Continuous | Per lifecycle policy (1y warm + archive) | AES-256 (server-side) |
| Secrets | Encrypted env in Vercel + Supabase | On rotation | Last 3 versions | KMS-wrapped |
| Audit chain | Synchronous WAL + nightly export | Continuous + nightly | 7 years (regulatory) | AES-256 + HMAC chain |
| Source code | GitHub | On commit | Indefinite | TLS in transit, repo encryption |

Backup-restore test runs **monthly** in CI (already wired — see existing task list "Wave 2 N").

## 6. Testing

### 6.1 Testing scope

- Annual full DR exercise (declared incident → full failover → service restored → failback)
- Quarterly partial drills (specific scenario from §2)
- Monthly backup-restore test (CI)
- Monthly call-tree test

### 6.2 Testing record

Test results recorded in `Docs/RUNBOOKS/` and reported to Risk Committee. After-action review for each exercise.

> TODO: insert most recent annual DR exercise after-action report (target Q3 2026).

## 7. Vendor BCP

For each Tier-1 vendor (Supabase, Vercel, Cloudflare, Twilio, ElevenLabs, Anthropic, OpenAI, M-Pesa, Airtel), Borjie maintains:

- Vendor's published RTO / RPO
- Vendor's SOC 2 / ISO 27001 evidence
- Contractual BCP test obligations
- Our own fallback plan if vendor unavailable for > vendor RTO

See doc 09 for vendor-by-vendor breakdown.

## 8. Communication plan during DR

- Tenant + property-mgr + owner status banner (`status.borjie.com`, planned)
- WhatsApp broadcast for major outages
- SMS fallback if WhatsApp / app down
- Email to institutional clients
- Regulator notification per doc 07 §5

## 9. Implementation references

| Capability | Source-of-truth (path:line) |
|---|---|
| Payments-ledger durable outbox + idempotency | `services/payments-ledger/src/` (Drizzle migration after Z-FF); idempotency key store |
| Webhook receivers (M-Pesa, Airtel, TigoPesa, HaloPesa, GePG) | `services/webhooks/src/` + `services/api-gateway/src/routes/gepg.router.ts` |
| Audit hash-chain replication + verification | `packages/ai-copilot/src/security/audit-hash-chain.ts` (651 lines) + `services/api-gateway/src/composition/audit-verify-cron.ts` |
| Sovereign-ledger verification cron | `services/api-gateway/src/composition/sovereign-ledger-verify-cron.ts` |
| Postgres HA + Redis Sentinel wiring | `infra/postgres-ha/` + Sentinel config in production compose (Wave-3 Z5 + W4-L) |
| Backup-restore CI check | `.github/workflows/` backup-restore job (Wave-2 N) |

## 10. BCM dashboards

| Dashboard | URL placeholder |
|---|---|
| Grafana — RTO / RPO tracker | `https://grafana.borjie.com/d/bcm-rto-rpo/bcm-rto-rpo-overview` |
| Grafana — payment-rail availability | `https://grafana.borjie.com/d/payments-availability/payment-rail-availability` |
| Grafana — DR drill last-run status | `https://grafana.borjie.com/d/bcm-drills/dr-drill-status` |
| Statuspage — public uptime | `https://status.borjie.com/` |

---

## Appendix A — Board Sign-Off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| CISO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/ciso/regulator-pack-tz-08-v1.0` |
| CTO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cto/regulator-pack-tz-08-v1.0` |
| Head of SRE | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/sre/regulator-pack-tz-08-v1.0` |
| Board Risk Committee Chair | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/brc/regulator-pack-tz-08-v1.0` |

## Appendix B — Version History

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial scaffold | CISO + CTO |
| 1.1.0 | 2026-05-22 | Implementation references + dashboards (Wave-12) | CISO + CTO |

## Appendix C — Review Cadence

- **Annual** — full DR exercise + plan refresh + board sign-off
- **Quarterly** — partial drill of one §2 scenario; after-action report to Risk Committee
- **Monthly** — backup-restore test in CI + call-tree test
- **Out-of-cycle** — material vendor SLA change, new payment rail, or post-P0 incident
