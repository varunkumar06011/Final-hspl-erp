# iOS App Build (Hospital ERP)

The React frontend is wrapped in a native iOS shell with [Capacitor](https://capacitorjs.com).
`.github/workflows/ios-build.yml` builds a **signed, App Store-ready `.ipa`** on a macOS
runner.

## Architecture

| Piece | Details |
|---|---|
| Native shell | Capacitor 8 (`frontend/capacitor.config.ts`), Xcode project at `frontend/ios` |
| App ID / name | `com.vgrand.hospitalerp` / "Hospital ERP" |
| Routing | `HashRouter` on native (bundled origin can't resolve deep paths) |
| API base | `src/config/appConfig.ts` — `VITE_API_URL` at build time, or the Railway prod URL as native fallback |
| PDFs / exports | `src/utils/native.ts` shims `window.open` + `<a download>` → native share sheet |
| External links | opened via `@capacitor/browser` (SFSafariViewController) |
| Push | `@capacitor-firebase/messaging` (native Firebase iOS SDK) — the device gets a real FCM token registered through the same `/notifications/subscribe` endpoint, so the backend needs no changes. Notification taps deep-link via `data.url` |
| Phone OTP | `iosScheme: https` makes the webview origin `https://localhost`, which Firebase treats as an authorized domain so reCAPTCHA/OTP works |

## One-time Apple setup

1. **App Store Connect**: create the app record with bundle id `com.vgrand.hospitalerp`.
2. **App ID capability**: on the `com.vgrand.hospitalerp` identifier
   (developer.apple.com → Identifiers), enable **Push Notifications**.
3. **Certificates** (developer.apple.com → Certificates): create an **Apple Distribution**
   certificate, download, import into Keychain, export as `.p12` with a password.
4. **Provisioning profile**: create an **App Store** profile for the bundle id using that
   certificate, download the `.mobileprovision`.
5. **App Store Connect API key** (for automatic TestFlight upload):
   Users and Access → Integrations → App Store Connect API → Team Keys → generate,
   download the `AuthKey_XXXX.p8` and note Key ID + Issuer ID.

## One-time Firebase/APNs setup (push notifications)

1. **Firebase console** → project `meditrust-erp` → add an **iOS app** with bundle id
   `com.vgrand.hospitalerp` → download `GoogleService-Info.plist`. Either commit it to
   `frontend/ios/App/App/` or store it base64-encoded in the
   `GOOGLE_SERVICE_INFO_PLIST` secret.
2. **APNs Auth Key** (developer.apple.com → Keys → +, enable *Apple Push Notifications
   service*) → download the `.p8`, then in Firebase console → Project settings →
   **Cloud Messaging** → Apple app configuration → **APNs authentication key** → upload
   with Key ID + Team ID. Without this, FCM cannot deliver to the device.

## GitHub secrets

| Secret | Value |
|---|---|
| `IOS_DISTRIBUTION_CERT_P12` | `base64 -i cert.p12` output |
| `IOS_DISTRIBUTION_CERT_PASSWORD` | the .p12 export password |
| `IOS_PROVISIONING_PROFILE` | `base64 -i profile.mobileprovision` output |
| `APP_STORE_CONNECT_KEY_ID` | API key ID (TestFlight upload) |
| `APP_STORE_CONNECT_ISSUER_ID` | Issuer ID (TestFlight upload) |
| `APP_STORE_CONNECT_KEY` | `base64 -i AuthKey_XXXX.p8` (TestFlight upload) |
| `GOOGLE_SERVICE_INFO_PLIST` | `base64 -i GoogleService-Info.plist` — skip if the file is committed |

Firebase/web build env vars are read from `vars.*` or `secrets.*` (secrets win):
`VITE_API_URL`, `VITE_QR_BASE_URL`, `VITE_FIREBASE_*`. Unset `VITE_API_URL` /
`VITE_QR_BASE_URL` fall back to the production Railway/Vercel URLs.

## Running the build

Actions → **iOS Build (.ipa)** → *Run workflow*. Set `app_version` (e.g. `1.0`) —
the build number is the workflow run number, which App Store Connect requires to
increment every upload. Tick **upload_to_testflight** to push straight to
App Store Connect. The `.ipa` is always uploaded as a workflow artifact.

## Regenerating icons / splash

```bash
cd frontend
node scripts/generate-ios-assets.mjs   # writes resources/*.png from public/logo.png
npx capacitor-assets generate --ios
```

## Local iteration (requires a Mac)

```bash
cd frontend
npm run build --workspace shared   # from repo root, first
npm run build
npx cap sync ios
npx cap open ios                   # opens Xcode
```
