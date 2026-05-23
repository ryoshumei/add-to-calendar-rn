# Sign in with Apple + in-app account deletion — Design

**Date:** 2026-05-23
**Status:** Approved (design), pending implementation plan

## Goal

Make the app pass App Store review with its Google sign-in intact, by adding
**Sign in with Apple** and an **in-app account deletion** flow. Both are
hard requirements for an app that ships Google sign-in (see Context). Google
sign-in, BYOK, and the free 50/month backend all stay exactly as they are
today.

## Context — why this is required (researched 2026-05-23)

- **Guideline 4.8 (Login Services), current text:** "Apps that **use** a
  third-party or social login service (…Google Sign-In…) to set up or
  authenticate the user's **primary account** must also offer as an equivalent
  option another login service [that limits data to name+email, lets users keep
  their email private, and does not collect interactions for ads]." A "primary
  account" is "the account they establish with your app for the purposes of
  identifying themselves, signing in, and accessing your features." Our Google
  sign-in creates a Supabase account used to sign in and reach the free backend
  → it is a primary account → 4.8 applies.
  - Apple **removed the word "exclusively"** from 4.8 (older text said "Apps
    that *exclusively* use…"). So "login is optional / BYOK also exists" is the
    exact loophole Apple closed — it no longer exempts us.
  - **BYOK does not satisfy the "equivalent option"** — it isn't a login service
    and offers no private-email option. The only practical option meeting all
    three criteria is **Sign in with Apple** (Hide My Email).
  - Real-world: recent rejections (Apple Developer Forums, Apr/Jul 2024) quote
    the verbatim 4.8 rejection email; an app that couldn't even create accounts
    on mobile was still rejected and told to add Sign in with Apple. Enforcement
    is active and broad.
- **Guideline 5.1.1(v), current text:** "If your app supports account creation,
  you must also offer **account deletion within the app**." Google (and now
  Apple) sign-in creates a Supabase user → in-app deletion is required,
  independent of 4.8.
- **Existing flow to mirror (`src/services/auth.ts`):** `useGoogleSignIn()` runs
  native Google → `id_token` → `supabase.auth.signInWithIdToken({ provider:
  'google', token })`. The Supabase session persists in SecureStore
  (`supabase.ts`). Apple uses the same `signInWithIdToken` shape with
  `provider: 'apple'`.
- **What the platform provides:** `expo-apple-authentication` gives a native
  Apple sign-in sheet, the standardized Apple button, and `isAvailableAsync()`.
  `expo-crypto` (already a dependency) provides SHA-256 for the nonce. Supabase
  supports the native Apple ID-token flow. Deleting a Supabase user needs the
  **service-role key**, which cannot live in the client — so deletion runs
  through a new Edge Function.

## Decisions

1. **Keep Google, add Apple.** Both sign-in options offered. No removal of any
   existing auth path; BYOK and the free backend are untouched.
2. **Native Apple flow (not web OAuth):** `expo-apple-authentication` →
   `supabase.auth.signInWithIdToken({ provider: 'apple', … })`. Consistent with
   Google, best UX, and needs no Apple `.p8` client secret in Supabase for
   native token verification. Exact **nonce handling follows Supabase's current
   Expo/React Native Apple guide** (raw nonce to Supabase, SHA-256 hash to
   Apple; `expo-crypto` is available if hashing is needed) — verified against
   the live guide at implementation time.
3. **Email scope only.** The app displays only the email (`StatusBanner`,
   `settings.tsx`), never the name, so request `EMAIL` scope. (`FULL_NAME` is
   harmless but unused — omitted, YAGNI.) Apple's Hide My Email relay address is
   a normal email and displays fine.
4. **Account deletion = clean hard delete.** New `delete-account` Edge Function
   (service-role): delete the user's `usage_tracking` rows, then
   `auth.admin.deleteUser(user.id)`. Client then signs out locally.
5. **Apple token revocation: deferred** (documented follow-up). Doing it
   properly needs an Apple `.p8` key, an ES256 client-secret JWT, capturing the
   `authorizationCode` at sign-in, exchanging it for a refresh token, and
   storing that token — roughly doubling backend work. Reviewers verify the
   in-app deletion flow, not the backend revoke call, and users can revoke via
   iOS Settings → Apple ID. Revisit if a reviewer flags it.
6. **Abuse accepted.** The 50/month counter is keyed by Supabase `user_id`
   (`process-text` `checkAndIncrementUsage(user.id)`), so delete + re-sign-in
   resets it. Value is pennies and re-auth has friction; no guard built.
7. **Apple button is iOS-only.** Gated by `AppleAuthentication.isAvailableAsync()`;
   hidden on Android/web. Apple requires it shown with equal-or-greater
   prominence than other social logins → placed **above** the Google row.
8. **Submission prep in README.** App Review notes + reviewer test guidance, to
   reduce the chance of a 4.8/5.1.1 misread.

## Architecture

```
Settings screen (signed out)
  ┌─────────────────────────────────────────┐
  │  [  Sign in with Apple  ]  ← native btn  │  iOS only (isAvailableAsync)
  │  🔐 Sign in with Google  ›  ← unchanged  │
  └─────────────────────────────────────────┘

Apple sign-in:
  AppleAuthentication.signInAsync({ scopes:[EMAIL], nonce })
        │  identityToken (+ nonce)
        ▼
  supabase.auth.signInWithIdToken({ provider:'apple', token, nonce })
        │  Supabase session (same as Google) → SecureStore
        ▼
  useAuth() re-renders → signed in

Account deletion (signed in):
  Settings "Delete account" → confirm Alert
        │  deleteAccount(accessToken)
        ▼
  POST EDGE_FUNCTIONS.DELETE_ACCOUNT  (Authorization: Bearer <jwt>)
        │
        ▼  delete-account Edge Function (service-role)
  delete usage_tracking where user_id = user.id
  auth.admin.deleteUser(user.id)
        │  200
        ▼
  client supabase.auth.signOut() → signed-out UI
```

## Components / changes

### Client (`add-to-calendar-rn`)

**`package.json`**
- Add dep via `npx expo install expo-apple-authentication` (resolves the
  SDK-52-correct version — do not hand-pin, per the share-intent version
  lesson). `expo-crypto` already present.

**`app.json`**
- Add `"expo-apple-authentication"` to `plugins`.
- Add `ios.usesAppleSignIn: true` (adds the Sign in with Apple entitlement on
  prebuild).

**`src/config.ts`**
- Add `EDGE_FUNCTIONS.DELETE_ACCOUNT:
  'https://pahcnlwgtghsctbnedhx.supabase.co/functions/v1/delete-account'`.
- Extend the fork comment to mention the new function.

**`src/services/auth.ts`**
- `isAppleSignInAvailable(): Promise<boolean>` wrapping
  `AppleAuthentication.isAvailableAsync()`.
- `signInWithApple(): Promise<void>` — build nonce (per Supabase RN guide) →
  `AppleAuthentication.signInAsync({ requestedScopes: [EMAIL], nonce })` →
  `supabase.auth.signInWithIdToken({ provider: 'apple', token: identityToken,
  nonce })`. Swallow user-cancel (`code === 'ERR_REQUEST_CANCELED'`); throw on
  missing `identityToken` or Supabase error.
- `deleteAccount(accessToken: string): Promise<void>` — POST to
  `EDGE_FUNCTIONS.DELETE_ACCOUNT` with `Authorization: Bearer` + `apikey` +
  `Content-Type` (mirror the headers in `llm.ts`); on non-OK throw with the
  parsed error; on success `await supabase.auth.signOut()`.

**`app/settings.tsx`**
- New `AppleSignInButton` sub-component: render
  `AppleAuthentication.AppleAuthenticationButton` (type SIGN_IN, style adapting
  to theme, full width ~48pt, cornerRadius 8), `onPress = signInWithApple`.
  Mount only when signed out **and** `isAppleSignInAvailable()` resolved true;
  place above the existing Google row in the ACCOUNT group.
- New destructive **"Delete account"** row, shown only when `auth.user` (below
  "Sign out") → confirmation `Alert` ("This permanently deletes your account.
  Your free monthly usage resets. This can't be undone.") → on confirm call
  `deleteAccount(auth.session.access_token)`; show an error Alert on failure.

### Backend (`../add-to-calendar`)

**`supabase/functions/delete-account/index.ts`** (new) — mirror `process-text`
boilerplate (CORS headers incl. `x-extension-version`; OPTIONS handler):
- Anon client with the caller's `Authorization` header → `auth.getUser()`;
  401 if missing/invalid.
- Service-role client (from `SUPABASE_SERVICE_ROLE_KEY`, already configured):
  `.from('usage_tracking').delete().eq('user_id', user.id)` then
  `auth.admin.deleteUser(user.id)`.
- Return `{ success: true }` 200; errors 401 (unauthorized) / 400 (other),
  matching `process-text`'s `err instanceof Error` narrowing for Deno strictness.

**`supabase/config.toml`**
- Add `[functions.delete-account]` with `verify_jwt = true`.

### Docs

**`README.md`** — add an "App Store readiness / submission" subsection:
- App Review notes to paste into App Store Connect: both Sign in with Apple and
  Google offered (4.8); in-app account deletion present (5.1.1(v)); BYOK works
  with no account; provide a reviewer test path.
- Setup steps (below).
- Note the deferred Apple token revocation as a known follow-up.

## Data flow

**Apple sign-in:** button → `signInAsync` → `identityToken` + nonce →
`signInWithIdToken({ provider: 'apple' })` → Supabase session persisted in
SecureStore → `useAuth()` re-renders signed-in. From here the app behaves
identically to a Google session (same `access_token` against Edge Functions).

**Deletion:** Settings → confirm → `deleteAccount(token)` → Edge Function
deletes `usage_tracking` rows + the auth user → client `signOut()` → UI returns
to signed-out. Signing in again (Apple or Google) mints a fresh user with usage
0 (expected, per Decision 6).

## Error handling / edge cases

- **Apple cancel:** `ERR_REQUEST_CANCELED` → no-op, no alert.
- **No `identityToken` / Supabase error:** throw → caller shows an alert.
- **Apple unavailable** (Android/web/simulator without an Apple ID): hide the
  Apple button; Google remains. App still fully usable.
- **Deletion network/Edge failure:** alert, keep the session intact (no partial
  client state change before the 200).
- **Deletion partial failure** (usage rows deleted but `deleteUser` fails):
  function returns non-200 → client does not sign out; safe to retry
  (re-deleting absent usage rows is idempotent).
- **Chrome extension unaffected:** `delete-account` is additive; `process-text`/
  `process-image` and the shared backend contract are unchanged.

## Prerequisites (user / accounts — I document, you run)

1. **Apple Developer:** enable the "Sign in with Apple" capability on App ID
   `com.addtocalendar.rn` (Xcode automatic signing can add it on the native
   rebuild, tied to the signing team).
2. **Supabase:** enable the **Apple** auth provider and add bundle ID
   `com.addtocalendar.rn` to its authorized client IDs (the native token's
   `aud`) — exactly mirroring the Google iOS client ID setup.
3. **Deploy** the `delete-account` function: `npx supabase functions deploy
   delete-account` (service-role secret already set from `process-text`).
4. Native rebuild: `npx expo prebuild` + `npx expo run:ios` (new entitlement).

## Testing

- `npx tsc --noEmit` for the client wiring.
- **Apple sign-in (device or simulator signed into an Apple ID):** tap Sign in
  with Apple → consent → app shows "Signed in as <email>". Confirm a backend
  text extraction works (counts against the 50/month).
- **Deletion:** while signed in (Apple or Google) → Settings → Delete account →
  confirm → returns to signed-out; signing in again starts a fresh session.
  Verify in Supabase that the `auth.users` row and `usage_tracking` rows are
  gone.
- **Cancel:** dismiss the Apple sheet → no error shown, still signed out.
- **Regression:** Google sign-in, BYOK, share-to, and the calendar flows all
  still work; Apple button hidden where unavailable.
- Backend: `delete-account` verified manually (service-role admin delete is hard
  to unit-test); confirm 401 without a JWT and 200 with a valid one.

## Out of scope (possible follow-ups)

- **Apple token revocation** via the Sign in with Apple REST API on deletion
  (Decision 5).
- **Abuse guard** for delete+recreate quota reset (Decision 6).
- **Email/anonymous auth** (researched as alternatives; not chosen).
- **Android** Apple button (Apple sign-in is Apple-platform only).
- Storing/displaying the Apple **full name** (email-only scope).

## Constraints / risks

- Requires the Apple Developer account (capability) and a Supabase Apple
  provider config; sign-in fails at the Supabase step until both are set, even
  though the button renders.
- New entitlement increases the native rebuild + App Store review surface.
- Deferred token revocation is a known, low-probability review/compliance gap.
- Apple returns the user's name only on first sign-in — irrelevant here
  (email-only), but worth remembering if name display is ever added.
