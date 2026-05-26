# @borjie/buyer-mobile - Production Readiness

Snapshot of where the app actually is, not where we'd like it to be. Updated as part of the mobile-app audit. Honest about what is wired, what is stubbed, and what blocks a demo / EAS submission.

## TL;DR

- TypeScript strict: passes (`pnpm -F @borjie/buyer-mobile typecheck`).
- App boots in Expo Go for the marketplace, bids, profile, and chat shells.
- Sign-in flow exists (`app/auth/login.tsx`) using OTP via api-gateway (`/api/v1/auth/otp` + `/api/v1/auth/verify`). Session persists in `AsyncStorage` via `src/auth/token.ts`.
- KYC document picker, image picker, and biometric sign-off require an **EAS dev build**.

## What works in Expo Go today

| Surface | State |
| --- | --- |
| App boots, expo-router renders tab shell | yes |
| OTP login flow (`app/auth/login.tsx`) compiles and posts to gateway | yes (auth route must be running) |
| `useSession()` hydrates a stub buyer (`preferredLang: 'en'`) so screens render before login completes | yes |
| Marketplace listing screen + filter rail + listing detail | yes (renders empty-state when no data) |
| Place-bid sheet, bids tab, bid detail | yes |
| Chat-per-bid screen with thread + composer | yes (uses `fetchBid`/`sendBidMessage`, not LLM SSE) |
| Profile + notification preferences | yes |
| KYC summary screen (status pill, document tiles) | yes (gallery picker works; camera launch needs EAS) |
| `apiFetch` sends `Authorization: Bearer ${token}` when token is present | yes |
| Empty-state component (`EmptyState`) on every list screen | yes |
| Default language English (stub user `preferredLang: 'en'`) | yes |
| Hardcoded URL sweep: only legitimate `?? ''` UI defaults remain; no mock imports | yes |

## What needs an EAS dev build

| Module | Used by | Behaviour in Expo Go |
| --- | --- | --- |
| `expo-image-picker` (camera launch) | `src/kyc/pickers.ts` (`pickIdImage` for NIDA front/back/selfie) | Gallery picker works; `launchCameraAsync` would throw - currently only `launchImageLibraryAsync` is called, so this path is Expo Go safe |
| `expo-document-picker` | `src/kyc/pickers.ts` (`pickRegistrationDoc` for TIN / business cert PDFs) | Usually works in Expo Go for system documents; iOS file-provider extensions may be limited |
| `expo-local-authentication` | `src/auth/biometric.ts` (`authenticateForSignature` for bid sign-off) | `hasHardwareAsync()` throws or returns false -> structured `{ok: false, reason: 'unavailable'}` (wrapped in try/catch as part of this audit) |
| `expo-secure-store` | (newly added to `app.json` plugins; not yet used in code - reserved for Supabase token persistence) | n/a |

## What is broken or missing

| Item | Status | Why |
| --- | --- | --- |
| Supabase Auth client | **not wired** | App uses OTP via gateway (`requestOtp`/`verifyOtp`) - which itself rides Supabase server-side, but no mobile-side `@supabase/supabase-js` client. If product wants Supabase magic-link / OAuth on the device, port it in. |
| Token storage uses `AsyncStorage` not `expo-secure-store` | **insecure** | `src/auth/token.ts` writes plain `AsyncStorage`. Should move to `expo-secure-store` for the OTP/Supabase bearer. |
| EAS project | **not provisioned** | `app.json` has `extra.eas.projectId = "REPLACE_WITH_EAS_PROJECT_ID"`. Run `eas init`. |
| App icons / splash | **placeholder** | Assets directory was empty; this audit copied workforce-mobile's placeholder PNGs in so bundling resolves. Replace before submission. |
| Apple/Google service account secrets | **not provisioned** | `eas.json` references `./secrets/google-play-service-account.json`, `BORJIE_BUYER_APPLE_APP_ID`, `BORJIE_APPLE_TEAM_ID`. |
| Floating "Ask Borjie" widget | **not present** | Workforce app has a stub button (`AskBorjie.tsx`); buyer app has none. Task references a sibling agent porting the floating widget - add `src/components/AskBorjie.tsx` pointing to `/api/v1/public/chat` for anonymous-browse screens and `/api/v1/mining/chat` for authenticated buyers when that lands. |
| `mockDistanceKm` in `src/marketplace/distance.ts` | **hardcoded** | Listing card shows fake km-from-buyer. Replace with real geocode + Haversine when the listing payload carries seller coords. |

## Fixes applied in this pass

1. `app.json`: added iOS `infoPlist` (camera + photo + FaceID descriptions), Android permissions (`CAMERA`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `USE_BIOMETRIC`, `USE_FINGERPRINT`), `expo-secure-store` plugin, `runtimeVersion.policy = "fingerprint"`, `extra.eas.projectId` placeholder, `updates.url` placeholder, `extra.apiGatewayUrl = "http://localhost:4001"`.
2. `eas.json` development profile: `EXPO_PUBLIC_API_GATEWAY_URL` flipped to `http://localhost:4001`.
3. `src/api/config.ts`: `FALLBACK_GATEWAY` updated from `:3001` to `:4001`.
4. `src/auth/biometric.ts`: wrapped the whole `authenticateForSignature` body in try/catch so a missing native module no longer throws into the JS runtime - returns `{ok: false, reason: 'unavailable'}` instead.
5. `assets/`: copied placeholder PNGs from workforce-mobile so `app.json` icon/splash/adaptive-icon paths resolve.

No code changes touched any feature behaviour.

## Steps to launch

```bash
# 1. Provision the EAS project.
cd apps/buyer-mobile
eas init
# (manually copy the printed projectId into app.json extra.eas.projectId AND updates.url)

# 2. Local dev (Expo Go) - covers everything except camera launch + biometric prompt.
pnpm -F @borjie/buyer-mobile start

# 3. EAS dev build (unlocks camera capture + biometric).
eas build --profile development --platform ios
eas build --profile development --platform android

# 4. Internal preview build.
eas build --profile preview --platform ios
eas build --profile preview --platform android

# 5. Production submission (after replacing icon/splash + provisioning service accounts).
eas build --profile production --platform ios
eas build --profile production --platform android
eas submit --profile production --platform ios
eas submit --profile production --platform android
```

## Outstanding before EAS submission

- Replace 4 placeholder PNGs in `assets/` (currently borrowed from workforce-mobile).
- Replace `REPLACE_WITH_EAS_PROJECT_ID` in `app.json`.
- Port `src/auth/token.ts` from `AsyncStorage` to `expo-secure-store`.
- Decide whether to add `@supabase/supabase-js` directly on mobile, or keep OTP-via-gateway as the only auth path.
- Replace `mockDistanceKm` with real distance computation.
- Add a floating "Ask Borjie" component if the buyer flow needs it; route anonymous traffic to `/api/v1/public/chat` and authenticated buyers to `/api/v1/mining/chat`.
- Replace placeholder Apple/Google submission credentials.
