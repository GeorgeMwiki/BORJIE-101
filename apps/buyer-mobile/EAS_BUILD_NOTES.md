# EAS Build Notes - @borjie/buyer-mobile

This app uses several native modules that **will not run in Expo Go**. To exercise the full feature surface you must produce a custom dev client via `eas build --profile development`.

## Native modules requiring an EAS dev build

| Module | Files | Permission strings |
| --- | --- | --- |
| `expo-image-picker` (camera launch) | `src/kyc/pickers.ts` (`pickIdImage`) | `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, Android `CAMERA` |
| `expo-document-picker` | `src/kyc/pickers.ts` (`pickRegistrationDoc`) | usually works in Expo Go, but file-provider extensions may be limited |
| `expo-local-authentication` | `src/auth/biometric.ts` (`authenticateForSignature`) | `NSFaceIDUsageDescription`, Android `USE_BIOMETRIC`, `USE_FINGERPRINT` |
| `expo-secure-store` | reserved for token persistence | none |

All call sites are wrapped in try/catch with a structured failure result so Expo Go does not crash - the screens degrade to a "not available in Expo Go" empty-state instead.

## How to build the dev client

```bash
cd apps/buyer-mobile
eas init   # one-time, fills extra.eas.projectId
eas build --profile development --platform ios
eas build --profile development --platform android
```

Install the resulting `.ipa`/`.apk` on a physical device, then run `pnpm start --dev-client` to load the JS bundle.

## Expo Go limitations checklist

When demoing in Expo Go, expect:

- KYC document gallery picker: works.
- KYC camera capture (NIDA front/back / selfie): blocked. Use the gallery path instead.
- Biometric bid sign-off: returns `{ok: false, reason: 'unavailable'}` -> UI shows the "biometric unavailable" empty-state.

Everything else (OTP login, marketplace, bids, chat, profile, KYC summary, listing detail) works against a running api-gateway on `http://localhost:4001`.
