# Add to Calendar (React Native)

iOS-first port of the [add-to-calendar](../add-to-calendar) Chrome extension.
Same shared Supabase backend, same Google sign-in flow, plus:

- **Image-to-event** — pick a poster, screenshot, or invite photo; OpenAI vision
  pulls the event details.
- **Native iOS UI** — grouped lists, large titles, system colors, light/dark.
- Runs on **iOS and Android** from one codebase.

## Two ways to use it

1. **Sign in with Google** (recommended) → uses the shared backend (no API key
   on device, 50 free requests/month per user). Same auth backend as the
   Chrome extension.
2. **Bring your own OpenAI key** → key stored in iOS Keychain / Android
   Keystore, sent directly to OpenAI. Required for **image** extraction (the
   shared backend is text-only today).

## Stack

- Expo SDK 52, React Native 0.76, `expo-router`
- `@supabase/supabase-js` + `expo-auth-session` for Google sign-in
- `expo-image-picker`, `expo-calendar`, `expo-secure-store`
- OpenAI `gpt-4.1-mini` for text and vision

## Setup

```bash
cd add-to-calendar-rn
npm install
```

### Forking? Point at your own Supabase project

`src/config.ts` is hard-coded to the maintainer's Supabase project (shared
with the sibling Chrome extension). To run this on your own backend, replace
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `EDGE_FUNCTIONS.PROCESS_TEXT` with
values from your Supabase project — and deploy the `process-text` Edge
Function there (see the sibling Chrome extension repo for the source).

If you're a maintainer working on the shared project, skip this and go
straight to "Configure Google sign-in" below.

### Configure Google sign-in

For iOS-only builds you need **at minimum the iOS** Google OAuth client.
Create it in Google Cloud Console, in the project connected to your Supabase
Google provider:

1. Go to <https://console.cloud.google.com/apis/credentials>.
2. **+ Create credentials** → **OAuth client ID** → **iOS** → bundle ID
   `com.addtocalendar.rn`. Copy the client ID.
3. Copy `.env.example` → `.env` and paste it in:

```env
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=xxxxxxxxxxxx-xxxxxxxxxxxx.apps.googleusercontent.com
```

*Optional, only if you also build for those platforms:*
- **Web** client (no redirect URI needed) → `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
- **Android** client (package `com.addtocalendar.rn` + SHA-1) → `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`

4. In Supabase Dashboard → Authentication → Providers → Google → *"Authorized
   Client IDs"*, add your **iOS** client ID (comma-separate alongside any
   existing Web client ID). The iOS native flow returns an ID token whose
   `aud` is the iOS client ID, so Supabase needs to trust it.

Without `.env` configured, the Settings screen shows "Google sign-in not
configured" and BYOK (OpenAI key) still works fine.

### Run

```bash
# iOS (requires Xcode + Simulator)
npm run ios

# Android
npm run android

# Or in Expo Go on your phone for a quick smoke test
npm start
```

The first `run:ios` regenerates the native `ios/` folder via `expo prebuild`.

## How it picks a provider

```
text input?                          image input?
├── you have an API key set?         ├── you have an API key set?
│   └── BYOK direct to OpenAI         │   └── BYOK to OpenAI vision
└── signed in with Google?            └── (no fallback — show "key required")
    └── shared backend (counts        
        toward your 50/month)        
```

## Architecture

```
add-to-calendar-rn/
├── app/                       # expo-router pages
│   ├── _layout.tsx            # Stack nav, large titles, light/dark
│   ├── index.tsx              # Home: text + image input, event preview
│   └── settings.tsx           # Modal-presented settings (Account, Key, About)
├── src/
│   ├── config.ts              # Supabase + Google client IDs
│   ├── services/
│   │   ├── auth.ts            # useAuth, useGoogleSignIn (Supabase)
│   │   ├── supabase.ts        # Supabase client w/ SecureStore session
│   │   ├── llm.ts             # Backend + BYOK extraction (text + image)
│   │   ├── calendar.ts        # expo-calendar + Google Calendar URL
│   │   └── storage.ts         # SecureStore wrapper for the OpenAI key
│   └── ui/theme.ts            # iOS system colors, light/dark, spacing
├── app.json                   # Permissions, scheme, bundle IDs
└── package.json
```

### Adding events

Each extracted event has two buttons:

- **Add to Calendar** — `expo-calendar` writes the event into the default
  writable calendar. Calendar permission requested on first use.
- **Open in Google** — opens the Google Calendar `render?action=TEMPLATE` URL
  in the system browser, works without an account.

## App Store readiness

- BYOK is compliant: the key is on-device (Keychain) and goes straight to
  `api.openai.com`. No server-side storage of user keys.
- Google sign-in is via the standard Apple OAuth pattern (`expo-auth-session`
  → `supabase.auth.signInWithIdToken`).
- Privacy disclosure: text and (when used) images are sent to OpenAI to
  extract events. Surface this in a privacy policy and the App Privacy
  questionnaire before submission. The Settings → OpenAI footnote already
  states this in-app.

## Permissions

| Platform | Permission | Why |
|---------|-----------|-----|
| iOS | `NSCameraUsageDescription` | Capture event posters |
| iOS | `NSPhotoLibraryUsageDescription` | Pick event posters |
| iOS | `NSCalendarsFullAccessUsageDescription` | Add events |
| Android | `CAMERA` / `READ_EXTERNAL_STORAGE` | Pick / capture |
| Android | `READ_CALENDAR` / `WRITE_CALENDAR` | Add events |
