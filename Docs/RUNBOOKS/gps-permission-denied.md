# Runbook: GPS Permission Denied (photo-advisor)

| Field        | Value                                             |
| ------------ | ------------------------------------------------- |
| Slug         | `gps-permission-denied`                           |
| Severity     | P2 (degrades vision context but doesn't block)    |
| Team         | mobile + vision                                   |
| Owner code   | `apps/workforce-mobile/src/photo-advisor/*`       |

## Symptoms

- Pilot user reports: "It keeps asking for my location."
- Sentry event: `GpsPermissionDenied` or `LocationPermissionDenied`.
- Photo-advisor logs show photos arriving with `gps_latitude=null`,
  `gps_longitude=null`.
- Vision recommendations are generic ("typical kimberlite") instead
  of site-specific ("Mwadui-style — flag for trace pyrope garnets").
- iOS users specifically — "Location access blocked" toast appears.

## Detection

- Sentry alert "GPS-null vision uploads > 30% in 15m for cohort".
- Bridge auto-files a GitHub Issue with label
  `runbook:gps-permission-denied`.

## Diagnosis

```sh
# 1. What fraction of recent uploads from this user lack GPS?
psql "$DATABASE_URL" -c "
  SELECT
    count(*) FILTER (WHERE gps_latitude IS NULL) AS no_gps,
    count(*) AS total,
    100.0 * count(*) FILTER (WHERE gps_latitude IS NULL) / count(*) AS pct
  FROM vision_uploads
  WHERE user_id = '$USER_ID'
    AND created_at > now() - interval '24 hours';
"

# 2. Did the mobile app emit a permission-denied event?
psql "$DATABASE_URL" -c "
  SELECT created_at, payload->>'reason', payload->>'platform'
    FROM mobile_telemetry_events
   WHERE user_id = '$USER_ID'
     AND event_name = 'gps_permission_denied'
   ORDER BY created_at DESC LIMIT 5;
"

# 3. What's the device platform + OS version?
psql "$DATABASE_URL" -c "
  SELECT platform, os_version, app_version
    FROM mobile_devices
   WHERE user_id = '$USER_ID'
   ORDER BY last_seen_at DESC LIMIT 1;
"
```

## Fix

Pick by platform / state:

1. **iOS user, status is `denied` (not just `notDetermined`)**:
   - The OS will NOT re-prompt. Walk the user through Settings →
     Borjie → Location → "While Using":
     ```
     Mwambie alikuwa na hatua hizi:
       1. Funga app.
       2. Settings → Borjie → Location → "Ukitumia App".
       3. Fungua Borjie tena, jaribu picha tena.
     ```
   - Confirm fix by checking telemetry for an `gps_permission_granted`
     event within 5 minutes:
     ```sh
     psql "$DATABASE_URL" -c "
       SELECT created_at FROM mobile_telemetry_events
        WHERE user_id = '$USER_ID' AND event_name = 'gps_permission_granted'
       ORDER BY created_at DESC LIMIT 1;"
     ```

2. **Android user, status is `denied`**:
   - On Android we CAN re-prompt up to 2× before user must go to
     Settings. Trigger the re-prompt remotely (test the flow first in
     staging):
     ```sh
     pnpm tsx scripts/mobile/send-push.ts \
       --user-id=$USER_ID \
       --type=permission_reprompt --permission=gps
     ```

3. **User has GPS off entirely (airplane mode, battery saver)**:
   - The mobile app already auto-detects this and shows "GPS is off —
     enable for better recommendations" in-app. Confirm the toast
     fired:
     ```sh
     psql "$DATABASE_URL" -c "
       SELECT created_at FROM mobile_telemetry_events
        WHERE user_id = '$USER_ID' AND event_name = 'gps_off_toast_shown'
       ORDER BY created_at DESC LIMIT 1;"
     ```
   - If toast did NOT fire, file a bug against the photo-advisor screen
     (this is a code defect, not a runbook problem).

4. **GPS is granted but accuracy is `low` (urban canyon, dense pit)**:
   - Vision pipeline still accepts the upload but flags it. Confirm:
     ```sh
     psql "$DATABASE_URL" -c "
       SELECT gps_accuracy_m FROM vision_uploads
        WHERE user_id = '$USER_ID'
        ORDER BY created_at DESC LIMIT 5;"
     ```
   - If `gps_accuracy_m > 50` is dominant, this is environmental — no
     fix possible. Document for the user.

5. **Privacy concern from user** ("I don't want to share location"):
   - Pilot escalation: ask user if a manual site-id picker is
     acceptable (we add the location, they pick from `[Mwadui,
     Tanzanite One, Songea]` etc.):
     ```sh
     pnpm tsx scripts/feature-flags/set.ts \
       --tenant=$TENANT_ID --user=$USER_ID \
       --flag=photo_advisor.manual_site_picker --value=true
     ```

## Prevention

- Permission priming screen BEFORE the OS prompt — explain why GPS
  improves recommendations. Shipped as
  `apps/workforce-mobile/src/photo-advisor/permission-primer.tsx`.
- Track `gps_permission_granted` rate as a pilot SLO; alert if <70%
  per cohort.
- Add "Why we need this" link in the OS permission dialog (iOS
  `NSLocationWhenInUseUsageDescription` already set in
  `app.config.ts`).
- Fallback path: vision still works without GPS — the recommendation
  is just less specific. Make this clear in copy.

## Severity

- **P2** during pilot — degrades quality but user is unblocked. SLA:
  ack 1h, walk-through within 24h.
- **P3** in production with permission priming.

## Linked Sentry fingerprints

_(Populated by `sentry-to-github.ts` over time. Initial list empty.)_
