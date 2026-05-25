# 09 — Vendors & Sub-Processors (Tanzania)

**Document version:** 1.0
**Date:** 2026-05-22
**Owner:** DPO + CISO
**Jurisdiction:** Tanzania
**Update cadence:** Quarterly + on any change (≥ 30 days prior notice to institutional clients)
**Aligned to:** BoT Outsourcing Guidelines 2021 §7; PDPA s.26 (cross-border transfer); SOC 2 vendor management criteria.

---

## 1. Sub-processor list

The list below is the **canonical sub-processor register**. Each entry includes vendor name, function, data residency, type of personal data shared, the legal basis for transfer (PDPA s.26), and the DPA reference.

### 1.1 AI providers

| Vendor | Function | Address | Data residency | Personal data | Cross-border basis | DPA / contract |
|---|---|---|---|---|---|---|
| **Anthropic, PBC** | LLM inference (Claude Opus / Sonnet / Haiku) for voice agent, kernel, debate, judge | 548 Market St, PMB 90375, San Francisco, CA 94104, USA | USA (us-east) with regional routing | Conversation text, property + lease context passed in prompts (PII scrubbed by `packages/ai-copilot/src/security/pii-scrubber.ts`) | EU SCCs + DPA; PDPA addendum | Anthropic MSA + DPA (`Docs/COMPLIANCE/` TODO) |
| **OpenAI, OpCo, LLC** | LLM inference (GPT-4 / 5), embeddings, Whisper STT (fallback) | 1455 3rd Street, San Francisco, CA 94158, USA | USA | Conversation text, voice for STT, embeddings of text | EU SCCs + Enterprise DPA (zero-data-retention tier) | OpenAI Enterprise Agreement + DPA |

### 1.2 Voice & messaging

| Vendor | Function | Address | Data residency | Personal data | Cross-border basis | DPA / contract |
|---|---|---|---|---|---|---|
| **ElevenLabs, Inc.** | TTS + STT for voice agent ("Mr. Mwikila") | 169 Madison Avenue, STE 11532, New York, NY 10016, USA | USA | Tenant voice + transcript | EU SCCs + DPA | ElevenLabs Enterprise + DPA |
| **Twilio, Inc.** | International voice + SMS + WhatsApp Business API | 101 Spear Street, San Francisco, CA 94105, USA | USA + Ireland | Phone numbers, message content, voice metadata | EU SCCs + DPA | Twilio MSA + DPA |
| **Africa's Talking Limited** | Tanzania-local voice, SMS, USSD | Bishop Magua Centre, Nairobi, Kenya | Kenya | Phone numbers, message content | Kenya cross-EAC adequacy; explicit consent | AT MSA + DPA |

### 1.3 Infrastructure

| Vendor | Function | Address | Data residency | Personal data | Cross-border basis | DPA / contract |
|---|---|---|---|---|---|---|
| **Supabase, Inc.** | Postgres + Auth + Storage + Realtime | 970 Toa Payoh North #07-04, Singapore | Frankfurt (`fra1` primary) + Mumbai (`bom1` standby) | All personal data (encrypted) | EU SCCs + DPA + Singapore PDPA-aligned | Supabase Enterprise + DPA |
| **Vercel, Inc.** | Frontend + serverless API hosting | 340 S Lemon Ave, #4133, Walnut, CA 91789, USA | Edge multi-region; compute fra1 + bom1 | Application data in flight only | EU SCCs + DPA | Vercel Enterprise + DPA |
| **Cloudflare, Inc.** | Edge / WAF / DDoS / DNS | 101 Townsend St, San Francisco, CA 94107, USA | Edge global; EU/US for management | Request metadata; no persistent body storage by default | EU SCCs + DPA | Cloudflare Enterprise + DPA |
| **Upstash, Inc.** | Redis (rate-limiting + cache) | 100 Pine St, Suite 1250, San Francisco, CA 94111, USA | EU multi-region | Rate-limit keys, cache values (transient) | EU SCCs + DPA | Upstash DPA |
| **AWS (KMS + S3)** | Envelope-key management + object storage for backups | 410 Terry Ave N, Seattle, WA 98109, USA | EU (Frankfurt) primary | Encrypted DEKs; encrypted backups | EU SCCs + DPA | AWS DPA + Business Associate Addendum N/A |
| **GitHub, Inc.** | Source control + CI | 88 Colin P Kelly Jr St, San Francisco, CA 94107, USA | USA + EU | No production personal data; engineer identity | EU SCCs (Microsoft) + DPA | GitHub Enterprise |
| **Sentry / equivalent** | Error monitoring | TODO | TODO | Error stack traces (no PII passthrough) | EU SCCs + DPA | TODO |

### 1.4 Payments rails (mobile money + bank)

| Vendor | Function | Data residency | Personal data |
|---|---|---|---|
| **Vodacom M-Pesa Tanzania** | Mobile-money disbursement / collection (largest TZ rail) | Tanzania | Phone number, transaction reference, tenant name |
| **Airtel Money Tanzania** | Mobile-money | Tanzania | Same |
| **TigoPesa (Yas Tanzania)** | Mobile-money | Tanzania | Same |
| **HaloPesa (Halotel)** | Mobile-money | Tanzania | Same |
| **GePG (Government e-Payment Gateway)** | Government-collection rail | Tanzania | Bill reference, payer details |
| **OLIPA Aggregator** | Multi-MNO aggregator (optional) | Tanzania | Same as above |
| **Local bank EFT (CRDB, NMB, etc. via partner)** | Bank disbursement to property owners | Tanzania | Account number, name, transaction details |

All mobile-money sub-processors are domestic; webhook signatures validated against per-vendor secret. See `services/payments-ledger/` for integration code.

### 1.5 Identity & tax

| Vendor | Function | Address | Data residency | Personal data | Cross-border basis |
|---|---|---|---|---|---|
| **NIDA (National Identification Authority)** | National ID lookup | Dar es Salaam, Tanzania | Tanzania | National ID number, demographics | Domestic; statutory |
| **TRA (Tanzania Revenue Authority)** | TIN verification, landlord-tax reporting feed | Dar es Salaam, Tanzania | Tanzania | TIN, taxpayer name | Domestic; statutory |
| **BRELA (Business Registration & Licensing Agency)** | Business registry lookup (for corporate tenants) | Dar es Salaam, Tanzania | Tanzania | Company name, registration | Domestic; statutory |
| **Smile Identity, Inc.** | Pan-African biometric KYC (face liveness, ID OCR) | 2261 Market Street, #4456, San Francisco, CA 94114, USA + Lagos, Nigeria | Multi-region (closest viable) | Face image, ID-document image (deleted after match), match score (retained) | EU SCCs + DPA + per-tenant consent | Smile MSA + DPA |

### 1.6 Email & notifications

| Vendor | Function | Address | Data residency | Personal data |
|---|---|---|---|---|
| **Resend / SendGrid / equivalent** | Transactional email | TODO | USA + EU | Email address, message content |
| **Firebase Cloud Messaging (Google)** | Mobile push notifications | Mountain View, CA, USA | USA + EU | Device tokens |

## 2. Vendor-management lifecycle

Per BoT Outsourcing Guidelines 2021 §7, due diligence is required prior to engagement and on an ongoing basis. Borjie's lifecycle:

| Stage | Activity | Sign-off |
|---|---|---|
| **Selection** | Multi-vendor evaluation; security questionnaire; SOC 2 / ISO 27001 evidence requested; financial-soundness check | CISO + CTO + procurement |
| **Onboarding** | DPA signed (EU SCCs where cross-border); sub-processor list updated; institutional-client notice 30 days | DPO + CISO |
| **Operational** | Quarterly review (SLA, incidents, breach notifications received); annual full re-assessment | Vendor manager + DPO |
| **Off-boarding** | Data export; cryptographic erasure of vendor-held data; certificate received; sub-processor list updated | DPO + CISO |

## 3. Risk classification

| Tier | Risk | Examples | Review cadence |
|---|---|---|---|
| **Tier 1 — Critical** | Vendor failure → P0/P1 incident | Supabase, Vercel, M-Pesa, Cloudflare | Quarterly |
| **Tier 2 — Important** | Vendor failure → P2 incident or compliance impact | Anthropic, OpenAI, ElevenLabs, Twilio, AT, Smile ID, AWS KMS | Bi-annual |
| **Tier 3 — Standard** | Vendor failure → P3 / cosmetic | Sentry, internal tooling | Annual |

## 4. Cross-references

- BCM coverage of vendor outages → doc 08 §2 + §7
- Sub-processor change notification to tenants → privacy notice + in-app notification

## 5. Sub-processor registry (source of truth)

The canonical sub-processor list in §1 is mirrored as code so that engineering signals + privacy notice + this regulator-pack cannot drift:

- Connector adapters: `packages/connectors/src/adapters/` (one file per vendor; `nida-adapter.ts`, `nida-real.ts`)
- Notification dispatcher adapter: `services/api-gateway/src/composition/notification-dispatcher-adapter.ts`
- MCP server bindings (per-vendor tools): `services/mcp-server-firs/`, `services/mcp-server-nggis/`, `services/mcp-server-nin/`, `services/mcp-server-opay/`, `services/mcp-server-process-intel/`
- Tax-export formatters: `services/reports/src/compliance/tz-tra-formatter.ts`, `ke-kra-formatter.ts`
- Connector documentation index: `Docs/connectors/`

---

## Appendix A — Board Sign-Off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| DPO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/dpo/regulator-pack-tz-09-v1.0` |
| CISO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/ciso/regulator-pack-tz-09-v1.0` |
| Procurement Lead | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/proc/regulator-pack-tz-09-v1.0` |
| Vendor Manager | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/vendmgr/regulator-pack-tz-09-v1.0` |

## Appendix B — Version History

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial scaffold | DPO + CISO |
| 1.1.0 | 2026-05-22 | Registry-as-code refs (Wave-12) | DPO + CISO |

## Appendix C — Review Cadence

- **Quarterly** — vendor manager + DPO review the Tier-1 vendor table
- **Bi-annual** — re-assessment of Tier-2 vendors (security questionnaire refresh)
- **Annual** — Tier-3 vendor re-assessment + full sub-processor list ratification
- **Out-of-cycle** — onboarding any new sub-processor (30-day prior notice to institutional clients) or vendor breach notification
