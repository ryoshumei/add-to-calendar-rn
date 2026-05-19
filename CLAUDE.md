# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install           # install deps
npm run ios           # build + run on iOS Simulator (Xcode required)
npm run android       # build + run on Android emulator/device
npm start             # Expo dev server for Expo Go (quick smoke test)
npm run prebuild      # regenerate native ios/ and android/ folders
npx tsc --noEmit      # type-check (no `lint` or `test` scripts exist)
```

The first `npm run ios` runs `expo prebuild` to regenerate `ios/`. Re-run prebuild after editing `app.json` permissions/plugins.

## Required environment

Copy `.env.example` → `.env` and fill in three Google OAuth client IDs before `npm run ios`. Without them, Google sign-in is broken but BYOK still works. See `README.md` for the Google Cloud Console + Supabase audience setup — the iOS native sign-in returns a token whose `aud` is the **iOS** client ID, so Supabase's Google provider must list **both** the iOS and Web client IDs under "Authorized client IDs."

## Architecture

This is an iOS-first port of the sibling Chrome extension at `../add-to-calendar`. It shares the same Supabase project (`src/config.ts`) and the same `process-text` Edge Function — so backend changes must stay compatible with both clients.

**Routing.** `expo-router` v4 with file-based routes in `app/`. `app/_layout.tsx` defines the stack (large titles, light/dark). Typed routes are enabled (`app.json` → `experiments.typedRoutes`).

**LLM provider routing (`src/services/llm.ts`).** Two modes that the home screen picks between based on input type and auth state:

| Input | Signed in (Google) | BYOK key set | Behavior |
|---|---|---|---|
| Text | ✓ | — | Shared backend (`process-text` Edge Function, counts toward 50/month) |
| Text | — | ✓ | Direct OpenAI from device |
| Image | — | ✓ | Direct OpenAI vision from device |
| Image | ✓ | — | **No fallback** — UI must surface "key required" |

The shared backend is **text-only today**. Any image flow goes BYOK direct to `api.openai.com`. If you add a `process-image` Edge Function on the backend, mirror it here in `extractEventsFromImage`.

**Auth (`src/services/auth.ts`, `supabase.ts`).** `expo-auth-session` runs native Google → ID token → `supabase.auth.signInWithIdToken`. The Supabase session is persisted in `expo-secure-store` (not AsyncStorage) via a custom storage adapter.

**Secrets storage (`src/services/storage.ts`).** The BYOK OpenAI key lives in iOS Keychain / Android Keystore via `expo-secure-store`. Never log it; never send it anywhere except `api.openai.com`. The Supabase session uses the same store. App Store compliance depends on this — see README "App Store readiness."

**Calendar writes (`src/services/calendar.ts`).** Two paths per event: native add via `expo-calendar` (requests `NSCalendarsFullAccessUsageDescription` on first use), and a Google Calendar `render?action=TEMPLATE` URL fallback that needs no account.

## Conventions

- TypeScript strict mode, path alias `@/*` → repo root (`tsconfig.json`).
- New React Native architecture is enabled (`app.json` → `newArchEnabled: true`); verify any native module supports it before adding.
- iOS bundle ID and Android package are both `com.addtocalendar.rn` — these are wired into the Google OAuth client IDs, so don't rename without re-issuing OAuth credentials.
- The Supabase **anon key in `src/config.ts` is intentionally committed** — it's the public client key; Edge Functions enforce auth. Don't move it to `.env`.
