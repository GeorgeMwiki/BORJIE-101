# Runbook: Persona Binding Lost on Reload

| Field        | Value                                              |
| ------------ | -------------------------------------------------- |
| Slug         | `persona-binding-lost-on-reload`                   |
| Severity     | P2 (UI loses context, user must re-pick persona)   |
| Team         | brain + chat-ui + auth                             |
| Owner code   | `packages/ai-copilot/src/personas/*`, `apps/*-web/src/persona-context.tsx` |

> Belt-and-braces: Agent 4 ships a persona-context persistence patch
> in Day 6. This runbook covers the residual cases where binding still
> drops (browser private mode, storage quota, multi-tab races).

## Symptoms

- Pilot user reports: "I selected Manager Mwikila but after refresh
  it forgot."
- Sentry event: `PersonaBindingLost` or `PersonaContextEmpty`.
- Junior agent responds with generic copy: "I'm here to help" instead
  of persona-bound: "Habari Mwikila, leo nina mapendekezo 3 ya..."
- `persona_id` is `null` in the chat-stream init event.
- Browser console (when reproducible): `PersonaProvider rendered with
  context=null`.

## Detection

- Sentry alert "PersonaBindingLost > 3 in 10m for cohort".
- Bridge auto-files a GitHub Issue with label
  `runbook:persona-binding-lost-on-reload`.

## Diagnosis

```sh
# 1. Confirm the user actually has a persona assigned server-side.
psql "$DATABASE_URL" -c "
  SELECT user_id, persona_id, role, updated_at
    FROM user_persona_bindings
   WHERE user_id = '$USER_ID';
"

# 2. Check the chat-stream init event for the failed session.
psql "$DATABASE_URL" -c "
  SELECT created_at, payload->'persona' AS persona_meta
    FROM chat_stream_events
   WHERE session_id = '$SESSION_ID' AND kind = 'init'
   ORDER BY created_at DESC LIMIT 1;
"

# 3. Was the user on a known browser/mode (private/incognito breaks
#    IndexedDB)?
psql "$DATABASE_URL" -c "
  SELECT user_agent, payload->>'storage_quota_kb', payload->>'is_private_mode'
    FROM web_telemetry_events
   WHERE user_id = '$USER_ID' AND event_name = 'persona_load_attempt'
   ORDER BY created_at DESC LIMIT 5;
"
```

## Fix

Pick by root cause:

1. **Server-side binding exists, client-side localStorage is empty**:
   - Force the client to re-fetch on mount. The persona-context
     provider already has this code path — it's failing because the
     fetch endpoint is hitting cache. Bust the cache:
     ```sh
     pnpm tsx scripts/cache/invalidate-personas.ts --user-id=$USER_ID
     ```
   - Ask user to hard-refresh (Cmd+Shift+R / Ctrl+F5).

2. **Browser is in private/incognito mode** (`is_private_mode=true`):
   - IndexedDB persistence is unreliable in private mode. Mobile
     workforce-app uses Expo SecureStore (works fine); web cockpits
     show a banner. Confirm the banner is being shown:
     ```sh
     psql "$DATABASE_URL" -c "
       SELECT created_at FROM web_telemetry_events
        WHERE user_id = '$USER_ID'
          AND event_name = 'private_mode_banner_shown'
        ORDER BY created_at DESC LIMIT 1;"
     ```
   - If banner did NOT fire, that's a code defect — file as a separate
     issue.

3. **Multi-tab race** (user opened owner-web in tab A AND tab B with
   different personas):
   - The persona-context uses a `BroadcastChannel` to sync. If the
     two tabs differ, the last-write-wins. Confirm:
     ```sh
     psql "$DATABASE_URL" -c "
       SELECT created_at, payload->>'tab_id', payload->>'persona_id'
         FROM web_telemetry_events
        WHERE user_id = '$USER_ID'
          AND event_name = 'persona_changed'
          AND created_at > now() - interval '10 minutes'
        ORDER BY created_at;"
     ```
   - If multi-tab race confirmed, ask user to close the other tab.

4. **Storage quota exceeded** (`storage_quota_kb < 1024`):
   - User has hit browser quota (typically 5MB on mobile Safari). Clear
     stale data:
     ```sh
     pnpm tsx scripts/mobile/send-clear-cache.ts --user-id=$USER_ID
     ```

5. **Persona was deleted server-side** (admin removed the user's
   persona):
   - The client's cached id no longer resolves. Recreate or reassign:
     ```sh
     pnpm tsx scripts/personas/reassign.ts \
       --user-id=$USER_ID --persona-id=$NEW_PERSONA_ID
     ```

## Prevention

- The persona-context provider MUST set the persona BEFORE the first
  brain call. Verify the lifecycle ordering in
  `packages/ai-copilot/src/personas/lifecycle.ts`.
- Persist persona id in BOTH localStorage AND a cookie (for SSR
  fallback). Already shipped as
  `apps/owner-web/src/persona-context.tsx`.
- Server-side: if a chat-stream init event arrives with `persona_id =
  null`, look up the user's binding and inject it (don't fail the
  request). Currently lives in
  `services/api-gateway/src/composition/persona-injection.middleware.ts`.
- Alert if persona-fetch latency > 500ms p95 — slow loads cause
  apparent "binding loss" when the brain races ahead.

## Severity

- **P2** during pilot — annoying UX but user is not blocked. SLA:
  ack 1h, fix in next patch.
- **P3** in production with banner + auto-recovery.

## Linked Sentry fingerprints

_(Populated by `sentry-to-github.ts` over time. Initial list empty.)_
