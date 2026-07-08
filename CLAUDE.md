# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install           # install deps (runs patch-package via postinstall)
npm run ios           # build + run on iOS Simulator (Xcode required)
npm run android       # build + run on Android emulator/device
npm start             # Expo dev server for Expo Go (quick smoke test)
npm run prebuild      # regenerate native ios/ and android/ folders
npx tsc --noEmit      # type-check (no `lint` or `test` scripts exist)
```

The first `npm run ios` runs `expo prebuild` to regenerate `ios/`. Re-run prebuild after editing `app.json` permissions/plugins. There is no test or lint suite — `npx tsc --noEmit` is the only static check.

## Required environment

Copy `.env.example` → `.env` and fill in at least `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` before `npm run ios`. Web and Android client IDs are only needed if you build those platforms. Without any IDs configured, the Settings screen gracefully degrades — Google sign-in shows "not configured", but **Sign in with Apple** and BYOK (OpenAI key) still work (this is enforced by the `GoogleSignInRow` sub-component in `app/settings.tsx`, which only mounts when at least one client ID is present, since `expo-auth-session`'s Google hook throws otherwise). See `README.md` for the Google Cloud Console + Supabase setup — the iOS native flow returns a token whose `aud` is the **iOS** client ID, so Supabase's Google provider must list the iOS client ID under "Authorized client IDs" (alongside the existing Web one used by the Chrome extension).

## Architecture

This is an iOS-first port of the sibling Chrome extension at `../add-to-calendar`. It shares the same Supabase project (`src/config.ts`) and the same Edge Functions — so backend changes must stay compatible with both clients. **Forks** should replace `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and the `EDGE_FUNCTIONS` URLs in `src/config.ts` with their own Supabase project's values, and deploy the `process-text`, `process-image`, `apple-link`, and `delete-account` Edge Functions there (source lives in the Chrome extension repo).

**Routing.** `expo-router` v4 with file-based routes in `app/`. `app/_layout.tsx` defines the stack (large titles, light/dark; Settings is a modal) and wraps everything in `ShareIntentProvider`. Typed routes are enabled (`app.json` → `experiments.typedRoutes`). Two screens: `app/index.tsx` (Home) and `app/settings.tsx`.

**LLM provider routing (`src/services/llm.ts`).** The home screen (`handleExtract`) picks a path per input based on auth state and whether a BYOK key is set. **A BYOK key takes precedence over the shared backend** — if a key is present it is used even when the user is also signed in (the status banner reflects this: "Signed in as … · using your OpenAI key").

| Input | BYOK key set | Signed in, no key | Neither |
|---|---|---|---|
| Text | Direct OpenAI (`extractEventsFromText`) | Backend `process-text` (counts toward 50/month) | UI blocks: "sign in or add a key" |
| Image | Direct OpenAI vision (`extractEventsFromImage`) | Backend `process-image` (counts toward 50/month) | UI blocks: "sign in or add a key" |

Both text and image now have a shared-backend path (`extractEventsFromTextViaBackend` / `extractEventsFromImageViaBackend`) **and** a BYOK direct-to-`api.openai.com` path. Backend responses may return `{ eventDetails: { events } }` or `{ events }` plus a `usage` object — the parsers accept both shapes. Before upload, images are resized to 1600px wide and JPEG-compressed (`resizeForUpload`) to cut payload/token cost, then base64-encoded; the temp file is deleted from cache. Both backend calls send `Authorization: Bearer <supabase access token>`, the `apikey` anon header, and `X-Extension-Version` (from `CONFIG.APP.VERSION`).

**Auth (`src/services/auth.ts`, `supabase.ts`).** Two sign-in methods, both ending in `supabase.auth.signInWithIdToken`:
- **Google** — `expo-auth-session` native flow (`useGoogleSignIn` hook) → Google ID token → Supabase.
- **Apple** — `expo-apple-authentication` one-shot (`signInWithApple`), guarded by `isAppleSignInAvailable()` (iOS 13+ only). Uses a hashed nonce, and best-effort POSTs the Apple `authorizationCode` to the `apple-link` Edge Function so the account can be revoked server-side at deletion. User cancellation (`ERR_REQUEST_CANCELED`) is swallowed.

`useAuth()` is the shared hook exposing `{ user, session, loading }` and re-renders on sign-in/out. The Supabase session is persisted in `expo-secure-store` (AsyncStorage on web) via a custom storage adapter. **Account deletion** (`deleteAccount`) calls the `delete-account` Edge Function (revokes Apple tokens, deletes data + auth user) then signs out locally.

**Secrets storage (`src/services/storage.ts`).** The BYOK OpenAI key lives in iOS Keychain / Android Keystore via `expo-secure-store` (AsyncStorage on web). Never log it; never send it anywhere except `api.openai.com`. The Supabase session uses the same store. App Store compliance depends on this — see README "App Store readiness."

**Calendar writes (`src/services/calendar.ts`).** Two paths per event: native add via `expo-calendar` (requests `NSCalendarsFullAccessUsageDescription` on first use, picks the device's default writable calendar, tags events with the device time zone), and a Google Calendar `render?action=TEMPLATE` URL fallback that needs no account.

**Share-to (`app/+native-intent.ts`, `expo-share-intent`).** An iOS Share Extension (+ Android intent filter) lets the user share an image into the app from any app. `+native-intent.ts` routes the incoming deep link (`dataUrl=…`) to Home; Home reads the shared file via `useShareIntentContext()` and loads it as `imageUri`. The share extension is configured under `app.json` → `plugins` (`expo-share-intent`, image-only, app group `group.com.addtocalendar.rn`) and the EAS `appExtensions` block under `extra.eas.build`.

**In-app review (`src/services/review.ts`).** After a successful native calendar add, `recordSuccessfulAddAndMaybeAskForReview()` may trigger the OS store-review prompt via `expo-store-review`. Heavily throttled: requires ≥2 successful adds and asks at most once per app version (tracked in AsyncStorage). Fire-and-forget — it never throws and never blocks the add flow.

## Edge Functions (in `src/config.ts`)

- `process-text` — authenticated text → events (shared with Chrome extension).
- `process-image` — authenticated image (data URL) → events.
- `delete-account` — permanently deletes the user (revokes Apple tokens server-side).
- `apple-link` — stores the Apple authorization code for later revocation.

All enforce auth; the `SUPABASE_ANON_KEY` in `config.ts` is intentionally committed (public client key).

## Conventions

- TypeScript strict mode, path alias `@/*` → repo root (`tsconfig.json`).
- New React Native architecture is enabled (`app.json` → `newArchEnabled: true`); verify any native module supports it before adding.
- iOS bundle ID and Android package are both `com.addtocalendar.rn` — these are wired into the Google OAuth client IDs and the share-extension app group (`group.com.addtocalendar.rn`), so don't rename without re-issuing OAuth credentials and updating the app group.
- The Supabase **anon key in `src/config.ts` is intentionally committed** — it's the public client key; Edge Functions enforce auth. Don't move it to `.env`.
- `patch-package` runs on `postinstall`; patches live in `patches/`. Re-run `npx patch-package <pkg>` after hand-editing a dependency in `node_modules`.
- UI theming goes through `src/ui/theme.ts` (`useTheme()`, `spacing`, `radius`); components read semantic colors (`label`, `systemBlue`, `separator`, …) rather than hard-coded values, and adapt to light/dark automatically.
- `CONFIG.APP.VERSION` in `config.ts` is sent as the `X-Extension-Version` header to the backend; note it is tracked separately from the `version` in `package.json`/`app.json`.

## EAS / release

`eas.json` configures EAS Build for App Store production (iOS 26 SDK / Xcode 26 image). The iOS Share Extension is declared under `app.json` → `extra.eas.build.experimental.ios.appExtensions`. Release notes and submission history live in `docs/app-store-submission.md`; design specs and plans are under `docs/superpowers/`.
