# 08 — Business Continuity and Disaster Recovery (Kenya)

**Document version:** 1.0
**Date:** 2026-05-22
**Owner:** CISO + CTO
**Jurisdiction:** Kenya
**Aligned to:** CBK BCM Guideline CBK/PG/16; ISO 22301 Business Continuity Management; NIST SP 800-34r1 Contingency Planning Guide.

---

## 1. Mission-critical activities (MCAs)

Same MCAs as TZ pack (see `tz/08-business-continuity-and-DR.md` §1) with Kenya-specific payment-rail naming:

| MCA | Description | Tier | RTO | RPO |
|---|---|---|---|---|
| **MCA-01 — Authentication** | Tenant / property-mgr / owner / internal-ops login | T1 | **30 min** | **5 min** |
| **MCA-02 — Rent-collection rail (KE)** | Safaricom Daraja STK, Airtel Money KE, Pesalink, KCB Buni, Equity Eazzy webhooks + ledger writes | T1 | **2 h** | **15 min** |
| **MCA-03 — Audit chain** | Hash-chain audit log writes + integrity | T1 | **30 min** | **0 min** |
| **MCA-04 — Tenant identity** | IPRS / NIDA-KE + Smile Identity | T2 | **4 h** | **1 h** |
| **MCA-05 — Voice / WhatsApp / SMS** | Voice agent, communication channels | T2 | **4 h** | **1 h** |
| **MCA-06 — Customer app** | Tenant self-service | T2 | **4 h** | **1 h** |
| **MCA-07 — Estate-manager app** | Property-manager workbench | T2 | **4 h** | **1 h** |
| **MCA-08 — Owner portal** | Portfolio dashboards | T3 | **24 h** | **24 h** |
| **MCA-09 — Marketing site** | Public website | T3 | **24 h** | **24 h** |
| **MCA-10 — Reporting / analytics** | Periodic reports, KRA iTax disclosure feed | T3 | **24 h** | **24 h** |

## 2. Threat scenarios covered

Same scenarios as TZ pack. Kenya-specific:

| Scenario | Impact | Plan |
|---|---|---|
| **Safaricom Daraja outage** | Largest KE rent rail down | Auto-route to Airtel / Pesalink / direct bank; tenant notified |
| Airtel Money KE outage | Secondary MNO down | Other rails continue |
| Pesalink outage | Owner disbursement affected | Direct bank EFT fallback (KCB / Equity) |
| KCB Buni / Equity Eazzy outage | Owner bank rail | Alternate bank EFT |
| iTax reporting failure | Landlord tax disclosure feed | Manual export to landlord; resume on iTax restore |
| CA (national telecom) outage | All KE telecom down | Status banner; resume on restore |

## 3. RTO / RPO design

Same as TZ pack (WAL streaming, daily backups, PITR, multi-region).

## 4. Alternate site (CBK/PG/16)

CBK/PG/16 requires geographically remote alternate site. Same as TZ pack:

- **Primary:** Vercel + Supabase, `fra1` (Frankfurt)
- **Standby:** Vercel `bom1` (Mumbai); Supabase cross-region read-replica
- **Backup:** Encrypted object-storage third region

Kenya roadmap: AWS Africa (Cape Town `af-south-1` or future Nairobi `af-south-2` once GA) for KE-resident standby.

## 5. Backup strategy

Same as TZ pack:

| Asset | Method | Frequency | Retention | Encryption |
|---|---|---|---|---|
| Postgres | WAL + nightly `pg_dump` | Continuous + nightly | 7-day PITR + 30-day cold | AES-256 |
| Object storage | Cross-region replication | Continuous | Per lifecycle | AES-256 |
| Secrets | Encrypted env | On rotation | Last 3 versions | KMS-wrapped |
| Audit chain | Synchronous WAL + nightly export | Continuous + nightly | 7 years | AES-256 + HMAC |
| Source code | GitHub | On commit | Indefinite | TLS / repo encryption |

Backup-restore test runs monthly in CI.

## 6. Testing

- Annual full DR exercise
- Quarterly partial drills
- Monthly backup-restore test (CI)
- Monthly call-tree test

Records reported to Risk Committee.

> TODO: insert most recent KE-region DR exercise after-action report.

## 7. Vendor BCP

Tier-1 vendor list with Kenya-specific:

- Safaricom (Daraja) — SOC 2 evidence requested annually
- Airtel Money KE — vendor questionnaire annually
- Pesalink (IPSL) — bank-grade BCM expected
- KCB Buni, Equity Eazzy — per their published banking BCM

See doc 09 for full vendor table.

## 8. Communication plan during DR

- Tenant + property-mgr + owner status banner (`status.borjie.com`, planned)
- WhatsApp broadcast
- SMS fallback (Safaricom + Airtel KE SMS gateways)
- Email to institutional clients
- Regulator notification per doc 07 §5

## 9. KE implementation references

| Capability | Source-of-truth (path:line) |
|---|---|
| Daraja webhook receiver + idempotency | `services/webhooks/src/` (W4-B hardening) |
| Pesalink + KCB Buni + Equity Eazzy adapters | `packages/connectors/src/adapters/` |
| KE region routing (failover) | `packages/database/src/schemas/identity.schema.ts` + `services/api-gateway/src/composition/service-context.middleware.ts` |
| Postgres HA + Redis Sentinel | `infra/postgres-ha/` (Z5 + W4-L) |
| Backup-restore CI check | `.github/workflows/` (Wave-2 N) |

## 10. KE BCM dashboards

| Dashboard | URL placeholder |
|---|---|
| Grafana — KE RTO / RPO tracker | `https://grafana.borjie.com/d/bcm-rto-rpo/bcm-rto-rpo-overview?var-region=KE` |
| Grafana — KE payment-rail availability | `https://grafana.borjie.com/d/ke-banks/ke-bank-rail-availability` |
| Statuspage — KE public uptime | `https://status.borjie.com/?region=KE` |

---

## Appendix A — Board Sign-Off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| CISO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/ciso/regulator-pack-ke-08-v1.0` |
| CTO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cto/regulator-pack-ke-08-v1.0` |
| Head of SRE | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/sre/regulator-pack-ke-08-v1.0` |
| Board Risk Committee Chair | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/brc/regulator-pack-ke-08-v1.0` |

## Appendix B — Version History

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial scaffold | CISO + CTO |
| 1.1.0 | 2026-05-22 | KE implementation refs + dashboards (Wave-12) | CISO + CTO |

## Appendix C — Review Cadence

- **Annual** — full KE DR exercise + Board sign-off
- **Quarterly** — partial drill of one §2 scenario
- **Monthly** — backup-restore + call-tree test
- **Out-of-cycle** — vendor SLA change, new KE rail, post-P0 incident
