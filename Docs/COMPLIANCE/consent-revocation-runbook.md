# Consent Revocation Runbook

_Applies to: GDPR Art. 7(3), PDPA TZ s. 7(a) + s. 36, DPA KE s. 32, NDPA NG s. 26._

Consent must be **as easy to withdraw as to give** (GDPR Art. 7(3); PDPA echoes).
Withdrawal does NOT retroactively invalidate processing that occurred while
consent was valid (Art. 7(3) last sentence).

## Trigger sources

- In-app **Privacy Settings → Manage consents** toggle
- Email reply "STOP" / "UNSUBSCRIBE" / "OPT-OUT" to marketing comms
- SMS "STOP" reply to WhatsApp / SMS comms
- DPO-relayed manual request
- Regulator-relayed complaint

All paths funnel into `customer-app/api/me/consent` → updates
`customers.consent_state` JSON and emits a `consent.revoked` event.

## What consent revocation affects

Consent (Art. 6(1)(a) / s. 7(a) / s. 30(1)(a) / s. 25(1)(a)) is the lawful
basis for these data flows ONLY. Withdrawal **does not** stop processing
that has another lawful basis (contract performance, legal obligation,
legitimate interest).

| Data flow | Consent basis? | What happens on revocation |
|---|---|---|
| Lease & rent invoicing | Contract (b) | Continues — not affected |
| Tax filing | Legal obligation (c) | Continues — not affected |
| Fraud / security | Legitimate interest (f) | Continues — explicit balancing in DPIA |
| Marketing email / SMS | Consent (a) | **STOP** — flag `marketing_consent = false` |
| Marketplace listing | Consent (a) | **STOP** — depublish listing, retain transactions |
| Behavioural analytics (in-product) | Consent (a) | **STOP** — flag `analytics_consent = false`; flush sessions |
| Cross-border data transfer (TZ→EU) | Mixed — consent + SCC | If consent was the only basis: localise the tenant's data; if SCC also covers, processing continues |
| AI training on user data | Consent (a) | **STOP** — exclude user from training pipeline; expunge embeddings |
| Optional ML features (credit-score "explain" personalisation) | Consent (a) | **STOP** — fall back to baseline scoring |

## Action checklist on `consent.revoked`

1. **Update consent_state** — `consent_state.<purpose> = { granted: false, revoked_at: NOW() }`
2. **Marketing system** — remove from all distribution lists (email provider API)
3. **WhatsApp / SMS** — set `tenant.preferences.marketing_channels = []`
4. **Behavioural analytics** — purge open sessions; flag user-id excluded from analytics-pipeline ingestion
5. **AI training pipeline** — add user-id to `excluded_subjects` set; downstream training jobs honour exclusion
6. **AI memory / embeddings** — delete embeddings for vectors tagged with user-id (when consent was for personalisation)
7. **Marketplace** — for `marketplace_listings.lister_id = $user_id`: set `status = 'depublished_consent_revoked'`. Preserve historical transactions (other party's contract basis applies).
8. **Audit log** — append `consent.revoked` event with purpose, timestamp, channel of request
9. **Confirmation** — send confirmation through a different channel than the one used to revoke (avoids spamming the very channel they revoked)

## When consent revocation cascades to erasure

If the data subject's processing was ONLY justified by consent (and the
consent is now withdrawn for all purposes), the controller has no remaining
lawful basis. Erasure becomes required (GDPR Art. 17(1)(b)).

The executor flags this: when `consent_state` collapses to all-false AND
no contract / legal-obligation / legitimate-interest basis remains, route to
the RTBF executor automatically. Notify the subject.

## Granularity

Consent must be granular (Art. 7 + GDPR recital 32). BORJIE's consent
state has these toggles:

```
{
  marketing_email: true,
  marketing_sms: true,
  marketing_whatsapp: true,
  marketplace_visibility: true,
  behavioural_analytics: true,
  ai_personalisation: true,
  cross_border_transfer: true,
  third_party_share: false  // default-off
}
```

Each toggle is independently revocable. The privacy-settings UI surfaces
each with a clear plain-language label and the data classes it controls.

## Audit

Every consent state change writes a row to `consent_audit`:

```
{
  user_id, purpose, granted, prior_granted,
  changed_at, change_channel, change_actor (user / admin / regulator),
  ip_address, user_agent, signed_audit_hash
}
```

These rows are part of the audit-events corpus and follow the audit-retention
policy ([audit-log-retention-policy.md](./audit-log-retention-policy.md)).

## Statute citations

- GDPR Art. 7(3) — withdrawal as easy as giving
- GDPR Art. 17(1)(b) — erasure when consent withdrawn and no other basis
- PDPA TZ s. 36 — right to object
- DPA KE s. 32 — withdrawal of consent
- NDPA NG s. 26 + s. 39 — consent and objection

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
