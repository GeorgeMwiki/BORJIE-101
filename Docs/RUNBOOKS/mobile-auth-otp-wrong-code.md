# Runbook: Mobile Auth — OTP wrong code / expired

| Field        | Value                                            |
| ------------ | ------------------------------------------------ |
| Slug         | `mobile-auth-otp-wrong-code`                     |
| Severity     | P2 (high-volume, user-recoverable)               |
| Team         | mobile + auth                                    |
| Owner code   | `packages/auth/src/otp/verify.ts`, Supabase Auth |

## Symptoms

- Pilot user reports: "I typed the code but it said wrong."
- Sentry event: `AuthOtpWrongCode` or `AuthOtpExpired`.
- `auth_otp_verify` audit rows with `result='failed'` exceed
  successes for a single phone over 10m.
- In-app toast: "Code incorrect or expired."
- Cohort dashboard `Pilot · Auth funnel` step-3 abandonment > 30%.

## Detection

- Sentry alert "OTP verify failure > 5 in 10m for cohort
  `pilot_cohort:*`".
- Bridge auto-files a GitHub Issue with label
  `runbook:mobile-auth-otp-wrong-code`.

## Diagnosis

```sh
# 1. How many failed attempts in the last 15m for this user?
psql "$DATABASE_URL" -c "
  SELECT created_at, result, masked_code
    FROM auth_otp_attempts
   WHERE user_id = '$USER_ID'
     AND created_at > now() - interval '15 minutes'
   ORDER BY created_at DESC
   LIMIT 10;
"

# 2. When was the most recent OTP issued, and what was its TTL?
psql "$DATABASE_URL" -c "
  SELECT created_at, expires_at, expires_at - now() AS time_left
    FROM auth_otp_issued
   WHERE user_id = '$USER_ID'
   ORDER BY created_at DESC
   LIMIT 1;
"

# 3. Did the user receive an updated SMS after asking 'resend'?
twilio api:core:messages:list --to=$MSISDN --limit=5 \
  --properties=sid,status,dateSent
```

## Fix

Pick by symptom:

1. **Code legitimately expired (`time_left` negative)**:
   - Tell user: "Tap 'Resend code'. Codes expire 5 minutes after
     they're sent."
   - If the user reports they did not get the original within 5
     minutes, switch to `mobile-auth-otp-not-received.md`.

2. **Code typed wrong (multiple failed attempts with different
   `masked_code` values)**:
   - In-app, expand the input box from 4-digit grouped to single-box
     copy-from-SMS (UX-2 ticket; ship in Day 7 patch if not already
     in).
   - Manually verify the user by phone-channel and **issue a bypass
     code**:
     ```sh
     pnpm tsx scripts/auth/issue-bypass-code.ts \
       --user-id=$USER_ID --reason="otp-mistyped-pilot" --ttl=600
     ```

3. **Account is locked (3 failed attempts → 15-minute cooldown)**:
   - Confirm in Supabase Auth admin:
     ```sh
     curl -s "https://${SUPABASE_PROJECT_REF}.supabase.co/auth/v1/admin/users/$USER_ID" \
       -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" | jq '.banned_until'
     ```
   - **Force-unlock for pilot** (do NOT run in prod without
     human-in-loop):
     ```sh
     pnpm tsx scripts/auth/unlock-user.ts --user-id=$USER_ID \
       --reason="pilot-cohort-recovery"
     ```

4. **Code-replay attack suspected (>10 failures across 3+ MSISDNs in
   one minute)**:
   - This is NOT a runbook issue — escalate to security on-call. Stop
     issuing OTPs from the affected source MSISDN range until
     reviewed:
     ```sh
     pnpm tsx scripts/auth/quarantine-msisdn.ts --prefix=$MSISDN_PREFIX
     ```

## Prevention

- Set OTP TTL to 5 minutes — already enforced in
  `packages/auth/src/otp/issue.ts`. Do not increase.
- Surface countdown timer in mobile UI ("Code expires in 4:32").
- Disable autocomplete on the OTP input — TZ keyboards autocorrect
  digit groups.
- Cap to 3 attempts per code, 5 codes per 30m per user.
- Pilot daily-ops template asks pilots to read the SMS *before*
  typing, not paste from notification preview (which truncates).

## Severity

- **P2** during pilot — user can recover via resend/bypass. SLA: ack
  30m, fix within 8h.
- **P3** in production — built-in self-recovery is acceptable.

## Linked Sentry fingerprints

_(Populated by `sentry-to-github.ts` over time. Initial list empty.)_
