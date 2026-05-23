# Sign in with Apple + in-app account deletion (with Apple token revocation) — Design

**Date:** 2026-05-23
**Status:** Approved (design), pending implementation plan

## Goal

Make the app pass App Store review with its Google sign-in intact, by adding
**Sign in with Apple**, an **in-app account deletion** flow, and **Apple token
revocation** on deletion. All three are hard requirements for an app that ships
Google sign-in (see Context). Google sign-in, BYOK, and the free 50/month
backend all stay exactly as they are today.

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
  - **Apple-specific:** apps offering Sign in with Apple must **revoke the
    user's Apple tokens via the Sign in with Apple REST API** when the account
    is deleted. This requires capturing the `authorizationCode` at sign-in,
    exchanging it for a refresh token, and calling `/auth/revoke` at deletion.
  - **Google does NOT need a revocation call.** We exchange the Google
    `id_token` for a Supabase session and discard it (`auth.ts`), so no Google
    credential is stored off-device — already compliant with 5.1.1(v)'s
    "may not store credentials or tokens to social networks off of the device."
    Deleting the Supabase user severs the link.
- **Existing flow to mirror (`src/services/auth.ts`):** `useGoogleSignIn()` runs
  native Google → `id_token` → `supabase.auth.signInWithIdToken({ provider:
  'google', token })`. The Supabase session persists in SecureStore
  (`supabase.ts`). Apple uses the same `signInWithIdToken` shape with
  `provider: 'apple'`.
- **What the platform provides:** `expo-apple-authentication` gives a native
  Apple sign-in sheet (returns `identityToken` **and** `authorizationCode`), the
  standardized Apple button, and `isAvailableAsync()`. `expo-crypto` (already a
  dependency) provides SHA-256 for the nonce. Supabase supports the native Apple
  ID-token flow but does **not** capture/store the Apple refresh token, so we
  handle the code-exchange and revocation ourselves. Deleting a Supabase user
  needs the **service-role key**, which cannot live in the client — so deletion
  and the code-exchange run through Edge Functions.

## Decisions

1. **Keep Google, add Apple.** Both sign-in options offered. No removal of any
   existing auth path; BYOK and the free backend are untouched.
2. **Native Apple flow (not web OAuth):** `expo-apple-authentication` →
   `supabase.auth.signInWithIdToken({ provider: 'apple', … })`. Consistent with
   Google, best UX. Exact **nonce handling follows Supabase's current
   Expo/React Native Apple guide** (raw nonce to Supabase, SHA-256 hash to
   Apple; `expo-crypto` is available if hashing is needed) — verified against
   the live guide at implementation time.
3. **Email scope only.** The app displays only the email (`StatusBanner`,
   `settings.tsx`), never the name, so request `EMAIL` scope. (`FULL_NAME` is
   harmless but unused — omitted, YAGNI.) Apple's Hide My Email relay address is
   a normal email and displays fine.
4. **Account deletion = hard delete.** `delete-account` Edge Function
   (service-role): revoke Apple tokens (if any), delete the user's
   `usage_tracking` rows, then `auth.admin.deleteUser(user.id)`. Client then
   signs out locally. Handles Google and Apple users uniformly (only Apple users
   have a stored refresh token → only they get the revoke step).
5. **Apple token revocation = included.** On Apple sign-in, capture the
   `authorizationCode` and exchange it server-side for a refresh token (stored in
   `apple_refresh_tokens`). On deletion, use it to call Apple's `/auth/revoke`.
   The Apple **client secret** is an ES256 JWT generated in the Edge Function
   from a `.p8` key. Both the exchange and the revoke are **best-effort**: a
   failed exchange never blocks sign-in; a failed revoke never blocks deletion.
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

Apple sign-in (+ link for later revocation):
  AppleAuthentication.signInAsync({ scopes:[EMAIL], nonce })
        │  identityToken + authorizationCode (+ nonce)
        ▼
  supabase.auth.signInWithIdToken({ provider:'apple', token, nonce })
        │  Supabase session → SecureStore → useAuth() re-renders
        ▼
  POST EDGE_FUNCTIONS.APPLE_LINK { authorizationCode }   (best-effort)
        ▼  apple-link Edge Function
  build Apple client secret (ES256 from .p8)
  POST appleid.apple.com/auth/token (grant_type=authorization_code)
        │  refresh_token
        ▼  service-role upsert
  apple_refresh_tokens(user_id, refresh_token)

Account deletion (signed in):
  Settings "Delete account" → confirm Alert → deleteAccount(accessToken)
        ▼  POST EDGE_FUNCTIONS.DELETE_ACCOUNT (Authorization: Bearer <jwt>)
        ▼  delete-account Edge Function (service-role)
  look up apple_refresh_tokens[user.id]
    └─ if present: build client secret → POST /auth/revoke (best-effort)
  delete apple_refresh_tokens row(s) for user.id
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
- Add `EDGE_FUNCTIONS.DELETE_ACCOUNT` and `EDGE_FUNCTIONS.APPLE_LINK`
  (`…/functions/v1/delete-account`, `…/functions/v1/apple-link`).
- Extend the fork comment to mention the new functions.

**`src/services/auth.ts`**
- `isAppleSignInAvailable(): Promise<boolean>` wrapping
  `AppleAuthentication.isAvailableAsync()`.
- `signInWithApple(): Promise<void>` — build nonce (per Supabase RN guide) →
  `AppleAuthentication.signInAsync({ requestedScopes: [EMAIL], nonce })` →
  `supabase.auth.signInWithIdToken({ provider: 'apple', token: identityToken,
  nonce })`. On success, **best-effort** POST `credential.authorizationCode` to
  `EDGE_FUNCTIONS.APPLE_LINK` (Authorization Bearer session token + apikey);
  swallow/log any link failure (sign-in already succeeded). Swallow user-cancel
  (`code === 'ERR_REQUEST_CANCELED'`); throw on missing `identityToken` or
  Supabase error.
- `deleteAccount(accessToken: string): Promise<void>` — POST to
  `EDGE_FUNCTIONS.DELETE_ACCOUNT` with `Authorization: Bearer` + `apikey` +
  `Content-Type` (mirror `llm.ts` headers); on non-OK throw parsed error; on
  success `await supabase.auth.signOut()`.

**`app/settings.tsx`**
- New `AppleSignInButton` sub-component: render
  `AppleAuthentication.AppleAuthenticationButton` (type SIGN_IN, style adapting
  to theme, full width ~48pt, cornerRadius 8), `onPress = signInWithApple`.
  Mount only when signed out **and** `isAppleSignInAvailable()` resolved true;
  place above the existing Google row in the ACCOUNT group.
- New destructive **"Delete account"** row, shown only when `auth.user` (below
  "Sign out") → confirmation `Alert` ("This permanently deletes your account.
  Your free monthly usage resets. This can't be undone.") → on confirm call
  `deleteAccount(auth.session.access_token)`; error Alert on failure.

### Backend (`../add-to-calendar`)

**`supabase/functions/_shared/apple-client-secret.ts`** (new) —
`buildAppleClientSecret(): Promise<string>`: ES256 JWT (`iss`=`APPLE_TEAM_ID`,
`sub`/`aud`=`APPLE_CLIENT_ID`/`https://appleid.apple.com`, `iat`, `exp` ≤ 6
months, header `kid`=`APPLE_KEY_ID`) signed with `APPLE_PRIVATE_KEY` (the `.p8`
contents) imported via Web Crypto (`importKey('pkcs8', …, { name: 'ECDSA',
namedCurve: 'P-256' })`). Shared by `apple-link` and `delete-account`. Plus a
Deno test covering header/claim shape.

**`supabase/functions/apple-link/index.ts`** (new, `verify_jwt=true`) — mirror
`process-text` boilerplate (CORS incl. `x-extension-version`; OPTIONS):
- Anon client with caller's `Authorization` → `auth.getUser()`; 401 if invalid.
- Read `{ authorizationCode }`; build client secret; POST
  `https://appleid.apple.com/auth/token`
  (`grant_type=authorization_code&code=…&client_id=…&client_secret=…`,
  `application/x-www-form-urlencoded`) → `refresh_token`.
- Service-role upsert into `apple_refresh_tokens` (`onConflict: user_id`).
- Return `{ success: true }` 200; 401/400 errors with `err instanceof Error`
  narrowing (Deno strictness, as in `process-text`).

**`supabase/functions/delete-account/index.ts`** (new, `verify_jwt=true`):
- Anon client → `auth.getUser()`; 401 if invalid.
- Service-role client: select `refresh_token` from `apple_refresh_tokens` for
  `user.id`; **if present** build client secret and POST
  `https://appleid.apple.com/auth/revoke`
  (`token=<refresh_token>&token_type_hint=refresh_token&client_id=…&client_secret=…`)
  — best-effort (log on failure, continue).
- Delete `apple_refresh_tokens` row(s), delete `usage_tracking` rows
  (`.eq('user_id', user.id)`), then `auth.admin.deleteUser(user.id)`.
- Return `{ success: true }` 200; 401/400 on error.

**Migration** (`supabase/migrations/<ts>_apple_refresh_tokens.sql`, new):
```sql
create table public.apple_refresh_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);
alter table public.apple_refresh_tokens enable row level security;
-- No policies: service-role only (Edge Functions bypass RLS).
```

**`supabase/config.toml`**
- Add `[functions.delete-account]` and `[functions.apple-link]`, both
  `verify_jwt = true`.

**Secrets (Supabase function env):** `APPLE_CLIENT_ID` (= `com.addtocalendar.rn`),
`APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (the `.p8` file contents).
`SUPABASE_SERVICE_ROLE_KEY` already configured.

### Docs

**`README.md`** — add an "App Store readiness / submission" subsection:
- App Review notes for App Store Connect: both Sign in with Apple and Google
  offered (4.8); in-app account deletion present (5.1.1(v)); BYOK works with no
  account; provide a reviewer test path.
- Setup steps (below).

## Data flow

**Apple sign-in:** button → `signInAsync` → `identityToken` + `authorizationCode`
+ nonce → `signInWithIdToken({ provider: 'apple' })` → Supabase session in
SecureStore → `useAuth()` re-renders signed-in (identical to Google from here).
Then a best-effort `apple-link` call exchanges the code for a refresh token and
stores it.

**Deletion:** Settings → confirm → `deleteAccount(token)` → Edge Function
revokes Apple tokens (if a row exists) → deletes refresh-token row +
`usage_tracking` rows + the auth user → client `signOut()` → signed-out UI.
Re-signing-in (Apple or Google) mints a fresh user with usage 0 (expected,
Decision 6).

## Error handling / edge cases

- **Apple cancel:** `ERR_REQUEST_CANCELED` → no-op, no alert.
- **No `identityToken` / Supabase error:** throw → caller shows an alert.
- **`apple-link` exchange fails:** logged, **non-blocking** — the user is signed
  in; that account simply has no stored token (revoke is skipped at deletion).
  `authorizationCode` is returned on every native sign-in, so the next sign-in
  re-attempts the link (upsert).
- **`/auth/revoke` fails at deletion:** logged, **deletion proceeds anyway** —
  never trap a user in an undeletable account over an Apple endpoint hiccup.
- **Apple unavailable** (Android/web/simulator without an Apple ID): hide the
  Apple button; Google remains. App still fully usable.
- **Deletion network/Edge failure:** alert, keep the session intact (no client
  state change before the 200).
- **Idempotency:** re-running deletion is safe (rows already gone; cascade on
  `apple_refresh_tokens`).
- **Chrome extension unaffected:** `apple-link` / `delete-account` are additive;
  `process-text`/`process-image` and the shared contract are unchanged.

## Prerequisites (user / accounts — I document, you run)

1. **Apple Developer — capability:** enable "Sign in with Apple" on App ID
   `com.addtocalendar.rn` (Xcode automatic signing can add it on the native
   rebuild).
2. **Apple Developer — key:** create a **Sign in with Apple `.p8` key** (Keys →
   +), note the **Key ID**, and your **Team ID**; download the `.p8` once.
3. **Supabase — provider:** enable the **Apple** auth provider; add bundle ID
   `com.addtocalendar.rn` to its authorized client IDs (the native token's
   `aud`).
4. **Supabase — secrets:** set `APPLE_CLIENT_ID=com.addtocalendar.rn`,
   `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (`.p8` contents).
5. **Migration + deploy:** apply the `apple_refresh_tokens` migration; deploy
   `npx supabase functions deploy apple-link delete-account`.
6. **Native rebuild:** `npx expo prebuild` + `npx expo run:ios` (new entitlement).

## Testing

- `npx tsc --noEmit` for the client wiring.
- **Apple sign-in (device or simulator signed into an Apple ID):** tap Sign in
  with Apple → consent → "Signed in as <email>"; a backend text extraction
  works. Verify a row appears in `apple_refresh_tokens`.
- **Deletion (Apple user):** Settings → Delete account → confirm → signed-out;
  verify `auth.users`, `usage_tracking`, and `apple_refresh_tokens` rows for the
  user are gone, and the Apple sign-in for the app no longer appears under the
  Apple ID's active apps (revocation effective).
- **Deletion (Google user):** same, minus the Apple row / revoke step.
- **Cancel:** dismiss the Apple sheet → no error, still signed out.
- **Regression:** Google sign-in, BYOK, share-to, calendar flows still work;
  Apple button hidden where unavailable.
- **Backend:** `apple-client-secret` Deno test; `apple-link`/`delete-account`
  verified manually (401 without JWT, 200 with valid one).

## Out of scope (possible follow-ups)

- **Abuse guard** for delete+recreate quota reset (Decision 6).
- **Email/anonymous auth** (researched as alternatives; not chosen).
- **Android** Apple button (Apple sign-in is Apple-platform only).
- Storing/displaying the Apple **full name** (email-only scope).
- **Google** programmatic token revocation (not required — tokens not stored).

## Constraints / risks

- Requires the Apple Developer account (capability + `.p8` key), a Supabase
  Apple provider config, and 4 Apple secrets; sign-in / revoke fail at the
  backend step until these are set, even though the button renders.
- New entitlement increases the native rebuild + App Store review surface.
- ES256 client-secret generation in Deno (Web Crypto `importKey` for the `.p8`)
  must be correct; covered by a unit test.
- `.p8` private key is sensitive — lives only as a Supabase function secret,
  never in the client or git.
- Apple returns the user's name only on first sign-in — irrelevant here
  (email-only), but the `authorizationCode` IS returned every sign-in, so the
  stored refresh token self-heals on re-login.
