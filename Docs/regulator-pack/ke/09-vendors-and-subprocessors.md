# 09 — Vendors & Sub-Processors (Kenya)

**Document version:** 1.0
**Date:** 2026-05-22
**Owner:** DPO + CISO
**Jurisdiction:** Kenya
**Update cadence:** Quarterly + on any change
**Aligned to:** CBK/PG/15 (Outsourcing); DPA 2019 s.48 (cross-border); SOC 2 vendor management criteria.

---

## 1. Sub-processor list

### 1.1 AI providers

| Vendor | Function | Address | Data residency | Personal data | Cross-border basis | DPA / contract |
|---|---|---|---|---|---|---|
| **Anthropic, PBC** | LLM inference (Claude Opus / Sonnet / Haiku) | San Francisco, USA | USA | Conversation text, property + lease context (PII scrubbed) | EU SCCs + DPA + DPA-KE addendum | Anthropic MSA + DPA |
| **OpenAI, OpCo, LLC** | LLM inference (GPT-4 / 5), embeddings, Whisper | San Francisco, USA | USA | Conversation text, voice for STT | EU SCCs + Enterprise DPA (zero-data-retention) | OpenAI Enterprise + DPA |

### 1.2 Voice & messaging

| Vendor | Function | Address | Data residency | Personal data | Cross-border basis | DPA / contract |
|---|---|---|---|---|---|---|
| **ElevenLabs, Inc.** | TTS + STT for voice agent | New York, USA | USA | Tenant voice + transcript | EU SCCs + DPA | ElevenLabs Enterprise + DPA |
| **Twilio, Inc.** | International voice + SMS + WhatsApp Business | San Francisco, USA | USA + Ireland | Phone numbers, message content | EU SCCs + DPA | Twilio MSA + DPA |
| **Africa's Talking Limited** | Kenya-local voice, SMS, USSD | Nairobi, Kenya | Kenya | Phone numbers, message content | Domestic | AT MSA + DPA |

### 1.3 Infrastructure

| Vendor | Function | Data residency | Personal data | Cross-border basis |
|---|---|---|---|---|
| **Supabase, Inc.** | Postgres + Auth + Storage + Realtime | `fra1` primary + `bom1` standby | All personal data (encrypted) | EU SCCs + DPA |
| **Vercel, Inc.** | Frontend + serverless API | Edge multi-region | Application data in flight | EU SCCs + DPA |
| **Cloudflare, Inc.** | Edge / WAF / DDoS / DNS | Edge global | Request metadata | EU SCCs + DPA |
| **Upstash, Inc.** | Redis | EU multi-region | Rate-limit keys, cache values | EU SCCs + DPA |
| **AWS (KMS + S3)** | Envelope keys + backup object storage | EU (Frankfurt) → roadmap KE-South Africa (Cape Town `af-south-1`) | Encrypted DEKs + backups | EU SCCs + DPA |
| **GitHub, Inc.** | Source control + CI | USA + EU | No production PII; engineer identity | EU SCCs |

### 1.4 Payments rails (Kenya)

| Vendor | Function | Data residency | Personal data |
|---|---|---|---|
| **Safaricom (Daraja — M-Pesa Kenya)** | Largest KE mobile-money rail | Kenya | Phone number, transaction reference, tenant name |
| **Airtel Money Kenya** | Mobile-money | Kenya | Same |
| **Pesalink (IPSL)** | Interbank instant transfer (owner disbursement) | Kenya | Account number, name, transaction details |
| **KCB Group (Buni)** | Bank rail | Kenya | Account, name, transaction |
| **Equity Bank (Eazzy)** | Bank rail | Kenya | Account, name, transaction |

All Kenya payments sub-processors are domestic; webhook signatures validated against per-vendor secret. See `services/payments-ledger/`.

### 1.5 Identity & tax

| Vendor | Function | Address | Data residency | Personal data | Cross-border basis |
|---|---|---|---|---|---|
| **IPRS / NIDA-KE** | National ID lookup (subject to inter-agency MoU) | Nairobi, Kenya | Kenya | National ID number, demographics | Domestic; statutory |
| **KRA (Kenya Revenue Authority — iTax)** | TIN verification, MRI reporting feed | Nairobi, Kenya | Kenya | TIN, taxpayer name, rental income | Domestic; statutory |
| **BRS (Business Registration Service)** | Business registry lookup | Nairobi, Kenya | Kenya | Company name, registration | Domestic; statutory |
| **Smile Identity, Inc.** | Biometric KYC (face liveness, ID OCR) | USA + Lagos, Nigeria | Multi-region (closest viable) | Face image, ID-document image (deleted after match), match score | EU SCCs + DPA + per-tenant consent |

### 1.6 Email & notifications

Same as TZ pack:

- Resend / SendGrid / equivalent (transactional email)
- Firebase Cloud Messaging (mobile push)

## 2. Vendor-management lifecycle

Same lifecycle as TZ pack (CBK/PG/15 + DPA Reg. 2021 require comparable due-diligence):

| Stage | Activity | Sign-off |
|---|---|---|
| Selection | Multi-vendor evaluation; security questionnaire; SOC 2 / ISO evidence; financial soundness | CISO + CTO + procurement |
| Onboarding | DPA signed (SCCs); sub-processor list updated; client notice 30 days | DPO + CISO |
| Operational | Quarterly review; annual full re-assessment | Vendor manager + DPO |
| Off-boarding | Data export; cryptographic erasure; certificate; sub-processor list updated | DPO + CISO |

## 3. Risk classification

| Tier | Risk | KE examples | Review cadence |
|---|---|---|---|
| **Tier 1 — Critical** | Vendor failure → P0/P1 | Supabase, Vercel, Safaricom (Daraja), Cloudflare, KCB Buni | Quarterly |
| **Tier 2 — Important** | Vendor failure → P2 / compliance impact | Anthropic, OpenAI, ElevenLabs, Twilio, AT, Pesalink, Equity Eazzy, Smile, AWS KMS | Bi-annual |
| **Tier 3 — Standard** | Vendor failure → P3 / cosmetic | Sentry, internal tooling | Annual |

## 4. Cross-references

- BCM coverage of vendor outages → doc 08 §2 + §7
- Sub-processor change notification to tenants → privacy notice + in-app notification
- ODPC notification on sub-processor change where required by DPA Reg. 2021 → DPO assessment

## 5. Sub-processor registry (source of truth — KE)

The §1 sub-processor list is mirrored in code:

- KE connector adapters: `packages/connectors/src/adapters/` (Daraja, Pesalink, KCB Buni, Equity Eazzy adapter files; KE IPRS overlay)
- KRA iTax formatter: `services/reports/src/compliance/ke-kra-formatter.ts`
- Notification dispatcher adapter: `services/api-gateway/src/composition/notification-dispatcher-adapter.ts`
- Connector documentation index: `Docs/connectors/` (incl. `kra-erits.md`)

---

## Appendix A — Board Sign-Off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| DPO (ODPC-registered) | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/dpo/regulator-pack-ke-09-v1.0` |
| CISO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/ciso/regulator-pack-ke-09-v1.0` |
| Procurement Lead | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/proc/regulator-pack-ke-09-v1.0` |
| Vendor Manager | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/vendmgr/regulator-pack-ke-09-v1.0` |

## Appendix B — Version History

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial scaffold | DPO + CISO |
| 1.1.0 | 2026-05-22 | KE registry-as-code refs (Wave-12) | DPO + CISO |

## Appendix C — Review Cadence

- **Quarterly** — vendor manager + DPO Tier-1 review
- **Bi-annual** — Tier-2 re-assessment
- **Annual** — Tier-3 + full registry ratification
- **Out-of-cycle** — new sub-processor (30-day prior notice) or vendor breach
