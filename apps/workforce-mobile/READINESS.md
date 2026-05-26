# @borjie/workforce-mobile - Production Readiness

Snapshot of where the app actually is, not where we'd like it to be. Updated as part of the mobile-app audit. Honest about what is wired, what is stubbed, and what blocks a demo / EAS submission.

## TL;DR

- TypeScript strict: passes (`pnpm -F @borjie/workforce-mobile typecheck`).
- App boots in Expo Go for all screens that don't depend on native modules.
- Sign-in is a **stub role picker** (AsyncStorage-backed). No Supabase / OTP yet.
- Camera, microphone, location, biometric flows are wired but require an **EAS dev build** to exercise.

## What works in Expo Go today

| Surface | State |
| --- | --- |
| App boots, expo-router renders `(tabs)` shell | yes |
| Role picker at `app/onboarding/role.tsx` persists choice | yes |
| Tab navigation (home, field, decisions, docs, ask, cash, people, sites) | yes |
| `useI18n` defaults to English (`buildStubUser` returns `preferredLang: 'en'`) | yes |
| Empty-state placeholders (`PlaceholderList`, `StubBlocks`) on every data screen | yes |
| Ask Borjie round button at `src/components/AskBorjie.tsx` (UI-only, no LLM yet) | yes |
| `api/client.ts` request wrapper sends `Authorization: Bearer ${token}` when a token is present | yes |
| `streamChat` posts to `/api/v1/mining/chat` (fixed in this audit pass) | yes |
| Offline sync queue scaffolding (`src/sync`) compiles, drains queue on reconnect | yes |
| Hardcoded URL sweep: only legitimate `?? ''` UI defaults remain | yes |

## What needs an EAS dev build

These call native modules that are absent from Expo Go's pre-built client. The code is wrapped in try/catch and falls back to a stub or a permission-denied state, so the JS runtime never crashes - but the user cannot exercise the feature without a custom dev build.

| Module | Used by | Behaviour in Expo Go |
| --- | --- | --- |
| `expo-camera`, `expo-image-picker` (camera launch) | `src/media/usePhotoPicker.ts` (W-M-04 shift report, weighbridge plate capture) | Library picker works; `launchCameraAsync` throws -> screen shows error state |
| `expo-location` | `src/location/useLocation.ts` (drill-hole GPS, attendance fences) | Permission request returns denied -> "GPS unavailable" UX |
| `expo-av` (microphone) | `src/forms/VoiceRecorderControl.tsx` | Recording fails silently, falls back to text note |
| `expo-local-authentication` | `src/biometric/useFingerprintSign.ts` (letter sign-off) | `hasHardware()` is false -> `method: 'stub'` result is returned so flows complete |
| `expo-secure-store` | (newly added to `app.json` plugins; not yet used in code - reserved for Supabase token persistence) | n/a |

## What is broken or missing

| Item | Status | Why |
| --- | --- | --- |
| Supabase Auth client (`@supabase/supabase-js` + `expo-secure-store`) | **not wired** | Mobile auth still uses the stub `AuthProvider` with a role-picker. The api-gateway already verifies Supabase JWTs (`services/api-gateway/src/auth/supabase/*`); the mobile side needs to be ported. |
| Real sign-in screen | **not wired** | Only `onboarding/role.tsx` exists (dev role picker). |
| EAS project | **not provisioned** | `app.json` has `extra.eas.projectId = "REPLACE_WITH_EAS_PROJECT_ID"` and `updates.url` with the same placeholder. Run `eas init` and replace. |
| App icons / splash | **placeholder** | `assets/*.png` are 1024x1024 placeholders, all identical. Replace before submission. |
| Apple/Google service account secrets | **not provisioned** | `eas.json` references `./secrets/google-play-service-account.json`, `BORJIE_WORKFORCE_APPLE_APP_ID`, `BORJIE_APPLE_TEAM_ID`. |
| AskBorjie streaming end-to-end demo | **partial** | Streaming client exists (`src/chat/streamChat.ts`), but the `AskBorjie` button component itself is a UI stub - not wired to `useChat`. |
| Site fence list (`MOCK_SITES` in `src/location/fence.ts`) | **hardcoded** | Two literal fences (Geita, Mwanza). Replace with `/api/v1/mining/sites` fetch. |

## Fixes applied in this pass

1. `app.json`: added `runtimeVersion.policy = "fingerprint"`, `extra.eas.projectId` placeholder, `updates.url` placeholder, `expo-secure-store` plugin.
2. `app.json` `extra.apiGatewayUrl`: flipped from `https://api.borjie.local` to `http://localhost:4001` so Expo Go talks to the local api-gateway out of the box.
3. `eas.json` development profile: `EXPO_PUBLIC_API_GATEWAY_URL` flipped to `http://localhost:4001`.
4. `src/api/config.ts`: hard fallback updated from `:3001` to `:4001`; `CHAT_PREFIX` flipped from `/api/v1/chat` to `/api/v1/mining/chat` so SSE actually hits the Master Brain route.
5. Removed stray non-ASCII characters from `app.json` taglines (kept English-safe punctuation).

No code changes touched any feature behaviour.

## Steps to launch

Assuming a fresh checkout with `pnpm install` already run, and a logged-in `eas-cli`:

```bash
# 1. Provision the EAS project (replaces the REPLACE_WITH_EAS_PROJECT_ID placeholders).
cd apps/workforce-mobile
eas init
# (manually copy the printed projectId into app.json extra.eas.projectId AND updates.url)

# 2. Local dev (Expo Go) - non-native flows only.
pnpm -F @borjie/workforce-mobile start

# 3. EAS dev build (unlocks camera, GPS, biometric, audio).
eas build --profile development --platform ios
eas build --profile development --platform android

# 4. Internal preview build (Release).
eas build --profile preview --platform ios
eas build --profile preview --platform android

# 5. Production submission (after replacing icon/splash + provisioning service accounts).
eas build --profile production --platform ios
eas build --profile production --platform android
eas submit --profile production --platform ios
eas submit --profile production --platform android
```

## Outstanding before EAS submission

- Replace 4 placeholder PNGs in `assets/`.
- Replace `REPLACE_WITH_EAS_PROJECT_ID` in `app.json`.
- Wire Supabase Auth (`@supabase/supabase-js` + `expo-secure-store`) into `src/auth/AuthProvider.tsx`; remove the role-picker fallback.
- Wire `AskBorjie.tsx` to `useChat()` for real LLM round-trip.
- Replace `MOCK_SITES` with `miningApi.get('/sites')`.
- Replace placeholder Apple/Google submission credentials.
