# Runbook: Mobile Auth — OTP not received

| Field        | Value                                            |
| ------------ | ------------------------------------------------ |
| Slug         | `mobile-auth-otp-not-received`                   |
| Severity     | P1 during pilot (auth blocker for affected user) |
| Team         | mobile + auth + carrier-ops                      |
| Owner code   | `packages/auth/src/otp/*`, Supabase Auth         |

## Symptoms

- Pilot user reports: "I tapped 'Send code' but nothing arrived."
- Sentry event: `AuthOtpNotReceived` or `AuthSmsDeliveryTimeout`.
- `auth_otp_send` audit row exists but no `auth_otp_verify` follows
  within 5 minutes.
- Supabase Auth dashboard "Failed SMS" count rises.
- Affected MSISDNs are Tanzanian carriers (Vodacom `+25575`, Airtel
  `+25578`, Halotel `+25562`, Tigo `+25571`).

## Detection

- Sentry alert "OTP delivery failures > 3 in 10m for cohort
  `pilot_cohort:*`".
- Bridge auto-files a GitHub Issue with label
  `runbook:mobile-auth-otp-not-received`.
- Dashboard panel `Pilot · Auth funnel` shows step 2 (OTP sent) >
  step 3 (code entered) by >20%.

## Diagnosis

```sh
# 1. Confirm the SMS actually left Supabase.
curl -s "https://${SUPABASE_PROJECT_REF}.supabase.co/auth/v1/admin/audit?type=otp_sent&phone=$MSISDN" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" | jq '.[0]'

# 2. Check Twilio (or Supabase's bundled SMS provider) delivery status.
twilio api:core:messages:list --to=$MSISDN --limit=5 \
  --properties=sid,status,errorCode,errorMessage

# 3. Carrier-side: is the user's MSISDN in a known-bad range?
grep -E "^${MSISDN:0:7}" packages/auth/src/otp/known-bad-prefixes.txt || echo "not flagged"

# 4. Local time + SMS deliverability window (TZ regulators throttle
#    bulk SMS between 22:00 and 06:00 EAT in some districts).
TZ=Africa/Dar_es_Salaam date
```

## Fix

Decide based on the diagnostic that returns first:

1. **Supabase returned `status=undelivered` with errorCode 30003**
   (unreachable handset):
   - Ask user to confirm signal bars + retry from a window/outdoors.
   - If repeated, fall back to **email OTP**:
     ```sh
     # Set the user's primary identifier to email for this session.
     pnpm tsx packages/auth/src/otp/switch-to-email.ts --user-id=$USER_ID
     ```

2. **Supabase returned `status=failed` with errorCode 21408**
   (geo-permission for `TZ` not enabled):
   - Open Supabase dashboard → Auth → Phone → "Allowed regions" and
     add `+255`. Then:
     ```sh
     curl -s -X POST "https://${SUPABASE_PROJECT_REF}.supabase.co/auth/v1/otp" \
       -H "apikey: $SUPABASE_ANON_KEY" \
       -d "{\"phone\":\"$MSISDN\"}"
     ```

3. **Twilio confirmed delivery but user still says nothing arrived**:
   - Their SIM is provisioned with SMS off (rare on TZ pre-paid). Ask
     them to dial `*102#` (Vodacom) / `*149*02#` (Airtel) to confirm
     SMS reception is active.
   - If still nothing, **manually issue a one-time bypass code** (P1
     workflow):
     ```sh
     pnpm tsx scripts/auth/issue-bypass-code.ts \
       --user-id=$USER_ID --reason="otp-undeliverable-pilot" --ttl=600
     ```

4. **22:00–06:00 EAT and TZ regulator window applies**:
   - Surface in-app message "SMS may be delayed overnight per TZ
     carrier rules. Use email link instead." Default the pilot UX to
     email OTP between those hours (config flag
     `pilot.auth.prefer_email_after_2200_eat = true`).

## Prevention

- Pre-flight every new pilot phone via `scripts/pilot/preflight-sms.sh`
  before Day 1 — sends a test SMS and confirms within 30s.
- Maintain `packages/auth/src/otp/known-bad-prefixes.txt` after each
  incident. Add the user's MSISDN prefix when carrier truly cannot
  deliver.
- Wire fallback to **WhatsApp OTP** in Phase 2 (post-pilot) — Vodacom
  TZ has the highest WhatsApp penetration of any African carrier.
- Add cohort-level alert: if cohort `tz-pilot-1` exceeds 10% OTP
  delivery failure across any 30m window, page the auth on-call (not
  just file an issue).

## Severity

- **P1** during pilot — user is fully blocked from the app. SLA: ack
  30m, mitigate (bypass code or email switch) within 4h.
- **P2** in production — degraded auth funnel but bypass available.

## Linked Sentry fingerprints

_(Populated by `sentry-to-github.ts` over time. Initial list empty.)_
