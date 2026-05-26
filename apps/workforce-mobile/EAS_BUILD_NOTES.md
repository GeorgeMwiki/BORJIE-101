# EAS Build Notes - @borjie/workforce-mobile

This app uses several native modules that **will not run in Expo Go**. To exercise the full feature surface you must produce a custom dev client via `eas build --profile development`.

## Native modules requiring an EAS dev build

| Module | Files | Permission strings |
| --- | --- | --- |
| `expo-camera` | (declared in `app.json` plugins) | `NSCameraUsageDescription`, Android `CAMERA` |
| `expo-image-picker` (camera launch) | `src/media/usePhotoPicker.ts` | `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription` |
| `expo-location` | `src/location/useLocation.ts` | `NSLocationWhenInUseUsageDescription`, Android `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` |
| `expo-av` (microphone) | `src/forms/VoiceRecorderControl.tsx` | `NSMicrophoneUsageDescription`, Android `RECORD_AUDIO` |
| `expo-local-authentication` | `src/biometric/useFingerprintSign.ts` | `NSFaceIDUsageDescription`, Android `USE_BIOMETRIC`, `USE_FINGERPRINT` |
| `expo-secure-store` | reserved for Supabase token persistence | none |

All call sites are wrapped in try/catch with a stub fallback so Expo Go does not crash - the screens degrade to an empty/error state instead.

## How to build the dev client

```bash
cd apps/workforce-mobile
eas init   # one-time, fills extra.eas.projectId
eas build --profile development --platform ios
eas build --profile development --platform android
```

Install the resulting `.ipa`/`.apk` on a physical device, then run `pnpm start --dev-client` to load the JS bundle.

## Expo Go limitations checklist

When demoing in Expo Go, expect:

- Camera launch: error / no native module.
- GPS: permission denied -> "GPS unavailable" UX.
- Voice recorder: silent fail, falls back to text note.
- Biometric sign-off: returns `method: 'stub'`, flow completes without a real prompt.

Everything else (auth role picker, tab navigation, i18n, query layer, offline sync queue, AskBorjie UI shell) works.
