# Sign in with Apple + Account Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Sign in with Apple alongside the existing Google sign-in, plus an in-app account-deletion flow that revokes the user's Apple tokens — satisfying App Store Guidelines 4.8 and 5.1.1(v) so the app can ship.

**Architecture:** Apple sign-in mirrors the existing Google flow (`expo-apple-authentication` → `supabase.auth.signInWithIdToken({ provider: 'apple' })`). Account deletion and Apple token handling run in two new service-role Edge Functions: `apple-link` (exchange the Apple `authorizationCode` for a refresh token, store it) and `delete-account` (revoke via Apple `/auth/revoke`, then delete the user + their data). Google needs no revocation (its token is discarded at sign-in).

**Tech Stack:** Expo SDK 52 / React Native 0.76 / TypeScript (client repo `add-to-calendar-rn`); Supabase Edge Functions on Deno (backend repo `../add-to-calendar`); Apple Sign in with Apple REST API (ES256 client secret via Web Crypto).

## Repos, branches, and how to verify

- **Backend repo:** `/Users/ryan/WebstormProjects/add-to-calendar` — Tasks 1–4. Work on branch `feat/apple-auth-backend`. Gate per task: `deno test` / `deno check` (Deno required; the repo already uses Deno tests).
- **Client repo:** `/Users/ryan/WebstormProjects/add-to-calendar-rn` — Tasks 5–9. Work on branch `feat/sign-in-with-apple`. Gate per task: `npx tsc --noEmit`. **This repo has no JS test runner** (per `CLAUDE.md`: "no lint or test scripts exist") — do not look for jest; the type-check plus manual device testing (Task 10) are the gates.
- **Task 10** is user-run: Apple Developer + Supabase config, deploys, migration, end-to-end testing. Deploys are intentionally not automated.

Commit commands use `git -C <repo>` so they work regardless of the current directory.

---

## Task 1: Apple client-secret helper (backend, TDD)

Builds the ES256 JWT that Apple's `/auth/token` and `/auth/revoke` require, signed with the `.p8` key.

**Files:**
- Create: `/Users/ryan/WebstormProjects/add-to-calendar/supabase/functions/_shared/apple-client-secret.ts`
- Test: `/Users/ryan/WebstormProjects/add-to-calendar/supabase/functions/_shared/apple-client-secret.test.ts`

- [ ] **Step 1: Create the branch**

```bash
git -C /Users/ryan/WebstormProjects/add-to-calendar checkout -b feat/apple-auth-backend
```

- [ ] **Step 2: Write the failing test**

Create `supabase/functions/_shared/apple-client-secret.test.ts`:

```ts
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { buildAppleClientSecret } from "./apple-client-secret.ts";

// Wrap raw DER bytes in a PKCS#8 PEM (same shape as an Apple .p8 file).
function toPem(der: Uint8Array): string {
  let bin = "";
  for (const b of der) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/(.{64})/g, "$1\n");
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----`;
}

function decodePart(part: string): Record<string, unknown> {
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "===".slice((b64.length + 3) % 4);
  return JSON.parse(atob(padded));
}

Deno.test("builds a well-formed ES256 client secret JWT", async () => {
  const kp = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", kp.privateKey),
  );

  const jwt = await buildAppleClientSecret({
    teamId: "TEAM123456",
    keyId: "KEY1234567",
    clientId: "com.addtocalendar.rn",
    privateKey: toPem(pkcs8),
  });

  const [h, p, s] = jwt.split(".");
  const header = decodePart(h);
  const payload = decodePart(p);
  assertEquals(header.alg, "ES256");
  assertEquals(header.kid, "KEY1234567");
  assertEquals(header.typ, "JWT");
  assertEquals(payload.iss, "TEAM123456");
  assertEquals(payload.sub, "com.addtocalendar.rn");
  assertEquals(payload.aud, "https://appleid.apple.com");
  if (!s || s.length < 10) throw new Error("signature missing");
  if ((payload.exp as number) - (payload.iat as number) > 3605) {
    throw new Error("exp must be short-lived");
  }
});

Deno.test("rejects when config is missing", async () => {
  await assertRejects(
    () =>
      buildAppleClientSecret({
        teamId: "",
        keyId: "",
        clientId: "",
        privateKey: "",
      }),
    Error,
    "not configured",
  );
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `deno test /Users/ryan/WebstormProjects/add-to-calendar/supabase/functions/_shared/apple-client-secret.test.ts`
Expected: FAIL — `Module not found "./apple-client-secret.ts"`.

- [ ] **Step 4: Write the implementation**

Create `supabase/functions/_shared/apple-client-secret.ts`:

```ts
// Builds the ES256 "client secret" JWT required by Apple's /auth/token and
// /auth/revoke endpoints, signed with the Sign in with Apple .p8 private key.

const APPLE_AUD = "https://appleid.apple.com";

export interface AppleSecretConfig {
  teamId: string;
  keyId: string;
  clientId: string;
  privateKey: string; // contents of the .p8 (PKCS#8 PEM)
}

function configFromEnv(): AppleSecretConfig {
  return {
    teamId: Deno.env.get("APPLE_TEAM_ID") ?? "",
    keyId: Deno.env.get("APPLE_KEY_ID") ?? "",
    clientId: Deno.env.get("APPLE_CLIENT_ID") ?? "",
    privateKey: Deno.env.get("APPLE_PRIVATE_KEY") ?? "",
  };
}

function base64Url(input: Uint8Array | string): string {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/\\n/g, "\n") // tolerate escaped newlines from env vars
    .replace(/-----[^-]+-----/g, "") // strip BEGIN/END lines
    .replace(/\s+/g, ""); // strip remaining whitespace
  const bin = atob(body);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return der;
}

export async function buildAppleClientSecret(
  config: AppleSecretConfig = configFromEnv(),
): Promise<string> {
  const { teamId, keyId, clientId, privateKey } = config;
  if (!teamId || !keyId || !clientId || !privateKey) {
    throw new Error(
      "Apple client secret not configured (APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_CLIENT_ID / APPLE_PRIVATE_KEY)",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: keyId, typ: "JWT" };
  const payload = {
    iss: teamId,
    iat: now,
    exp: now + 3600, // short-lived; well under Apple's 6-month max
    aud: APPLE_AUD,
    sub: clientId,
  };
  const signingInput = `${base64Url(JSON.stringify(header))}.${
    base64Url(JSON.stringify(payload))
  }`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `deno test /Users/ryan/WebstormProjects/add-to-calendar/supabase/functions/_shared/apple-client-secret.test.ts`
Expected: PASS — `ok | 2 passed | 0 failed`.

- [ ] **Step 6: Commit**

```bash
git -C /Users/ryan/WebstormProjects/add-to-calendar add supabase/functions/_shared/apple-client-secret.ts supabase/functions/_shared/apple-client-secret.test.ts
git -C /Users/ryan/WebstormProjects/add-to-calendar commit -m "feat(backend): Apple client-secret (ES256) helper + test"
```

---

## Task 2: `apple_refresh_tokens` table + function config

**Files:**
- Create: `/Users/ryan/WebstormProjects/add-to-calendar/supabase/migrations/20260523000000_apple_refresh_tokens.sql`
- Modify: `/Users/ryan/WebstormProjects/add-to-calendar/supabase/config.toml`

- [ ] **Step 1: Create the migration**

Create `supabase/migrations/20260523000000_apple_refresh_tokens.sql`:

```sql
-- Stores the Apple refresh token per user so account deletion can revoke it
-- via Apple's /auth/revoke. Service-role only (Edge Functions bypass RLS).
create table if not exists public.apple_refresh_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

alter table public.apple_refresh_tokens enable row level security;
-- Intentionally no policies: only the service role (Edge Functions) may access.
```

- [ ] **Step 2: Add the two functions to `config.toml`**

Append to the end of `supabase/config.toml`:

```toml
[functions.apple-link]
verify_jwt = true

[functions.delete-account]
verify_jwt = true
```

- [ ] **Step 3: Verify the migration parses (no syntax error)**

Run: `grep -c "create table" /Users/ryan/WebstormProjects/add-to-calendar/supabase/migrations/20260523000000_apple_refresh_tokens.sql`
Expected: `1`. (The migration is applied for real in Task 10.)

- [ ] **Step 4: Commit**

```bash
git -C /Users/ryan/WebstormProjects/add-to-calendar add supabase/migrations/20260523000000_apple_refresh_tokens.sql supabase/config.toml
git -C /Users/ryan/WebstormProjects/add-to-calendar commit -m "feat(backend): apple_refresh_tokens table + apple-link/delete-account config"
```

---

## Task 3: `apple-link` Edge Function

Exchanges the Apple `authorizationCode` for a refresh token and stores it.

**Files:**
- Create: `/Users/ryan/WebstormProjects/add-to-calendar/supabase/functions/apple-link/index.ts`

- [ ] **Step 1: Write the function**

Create `supabase/functions/apple-link/index.ts`:

```ts
// Supabase Edge Function: apple-link
// Exchanges an Apple Sign In authorizationCode for a refresh token and stores
// it (per user) so the account can be revoked at deletion time.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildAppleClientSecret } from "../_shared/apple-client-secret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-extension-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const { authorizationCode } = await req.json();
    if (!authorizationCode || typeof authorizationCode !== "string") {
      throw new Error("authorizationCode is required");
    }

    // Exchange the code for a refresh token with Apple.
    const clientSecret = await buildAppleClientSecret();
    const tokenRes = await fetch("https://appleid.apple.com/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: Deno.env.get("APPLE_CLIENT_ID") ?? "",
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code: authorizationCode,
      }),
    });
    if (!tokenRes.ok) {
      throw new Error(
        `Apple token exchange failed: ${tokenRes.status} ${await tokenRes
          .text()}`,
      );
    }
    const { refresh_token } = await tokenRes.json();
    if (!refresh_token) throw new Error("Apple did not return a refresh_token");

    // Store it (service role bypasses RLS).
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { error: upsertError } = await admin
      .from("apple_refresh_tokens")
      .upsert({
        user_id: user.id,
        refresh_token,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
    if (upsertError) {
      throw new Error(`Failed to store token: ${upsertError.message}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("apple-link error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: error.message === "Unauthorized" ? 401 : 400,
      },
    );
  }
});
```

- [ ] **Step 2: Type-check the function**

Run: `deno check /Users/ryan/WebstormProjects/add-to-calendar/supabase/functions/apple-link/index.ts`
Expected: no errors (Deno fetches remote imports, then `Check ... ok`).

- [ ] **Step 3: Commit**

```bash
git -C /Users/ryan/WebstormProjects/add-to-calendar add supabase/functions/apple-link/index.ts
git -C /Users/ryan/WebstormProjects/add-to-calendar commit -m "feat(backend): apple-link function (exchange + store Apple refresh token)"
```

---

## Task 4: `delete-account` Edge Function

Revokes Apple tokens (if any), deletes the user's data, then the auth user.

**Files:**
- Create: `/Users/ryan/WebstormProjects/add-to-calendar/supabase/functions/delete-account/index.ts`

- [ ] **Step 1: Write the function**

Create `supabase/functions/delete-account/index.ts`:

```ts
// Supabase Edge Function: delete-account
// Deletes the caller's account: best-effort Apple token revocation, then
// removes their data (usage_tracking, apple_refresh_tokens) and the auth user.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildAppleClientSecret } from "../_shared/apple-client-secret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-extension-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Best-effort Apple token revocation (Google users have no row → skipped).
    const { data: tokenRow } = await admin
      .from("apple_refresh_tokens")
      .select("refresh_token")
      .eq("user_id", user.id)
      .maybeSingle();
    if (tokenRow?.refresh_token) {
      try {
        const clientSecret = await buildAppleClientSecret();
        const res = await fetch("https://appleid.apple.com/auth/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: Deno.env.get("APPLE_CLIENT_ID") ?? "",
            client_secret: clientSecret,
            token: tokenRow.refresh_token,
            token_type_hint: "refresh_token",
          }),
        });
        if (!res.ok) {
          console.error("Apple revoke failed:", res.status, await res.text());
        }
      } catch (revokeErr) {
        console.error("Apple revoke error (continuing):", revokeErr);
      }
    }

    // Delete data + auth user. Deletion always proceeds.
    await admin.from("apple_refresh_tokens").delete().eq("user_id", user.id);
    await admin.from("usage_tracking").delete().eq("user_id", user.id);
    const { error: delError } = await admin.auth.admin.deleteUser(user.id);
    if (delError) throw new Error(`Failed to delete user: ${delError.message}`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("delete-account error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: error.message === "Unauthorized" ? 401 : 400,
      },
    );
  }
});
```

- [ ] **Step 2: Type-check the function**

Run: `deno check /Users/ryan/WebstormProjects/add-to-calendar/supabase/functions/delete-account/index.ts`
Expected: no errors (`Check ... ok`).

- [ ] **Step 3: Commit**

```bash
git -C /Users/ryan/WebstormProjects/add-to-calendar add supabase/functions/delete-account/index.ts
git -C /Users/ryan/WebstormProjects/add-to-calendar commit -m "feat(backend): delete-account function (revoke Apple token + delete user/data)"
```

> **Backend phase done.** Open a PR for `feat/apple-auth-backend` (or hand to the user to deploy in Task 10).

---

## Task 5: Install `expo-apple-authentication` + `app.json`

**Files:**
- Modify: `/Users/ryan/WebstormProjects/add-to-calendar-rn/package.json` (via `expo install`)
- Modify: `/Users/ryan/WebstormProjects/add-to-calendar-rn/app.json`

- [ ] **Step 1: Create the branch**

```bash
git -C /Users/ryan/WebstormProjects/add-to-calendar-rn checkout -b feat/sign-in-with-apple
```

- [ ] **Step 2: Install the SDK-52-correct package**

Run: `cd /Users/ryan/WebstormProjects/add-to-calendar-rn && npx expo install expo-apple-authentication`
Expected: `package.json` gains `"expo-apple-authentication": "~7.x.x"` (let `expo install` pick the version — do not hand-pin).

- [ ] **Step 3: Add the plugin to `app.json`**

In `app.json`, add `"expo-apple-authentication"` to the `plugins` array (after `"expo-router"` is fine). The array head becomes:

```json
    "plugins": [
      "expo-router",
      "expo-apple-authentication",
      [
        "expo-image-picker",
```

- [ ] **Step 4: Enable the entitlement in `app.json`**

In `app.json`, add `usesAppleSignIn` to the `ios` block (alongside `supportsTablet` / `bundleIdentifier`):

```json
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.addtocalendar.rn",
      "usesAppleSignIn": true,
      "infoPlist": {
```

- [ ] **Step 5: Verify it type-checks and the JSON is valid**

Run: `cd /Users/ryan/WebstormProjects/add-to-calendar-rn && npx tsc --noEmit && node -e "JSON.parse(require('fs').readFileSync('app.json','utf8')); console.log('app.json OK')"`
Expected: no TS errors; prints `app.json OK`.

- [ ] **Step 6: Commit**

```bash
git -C /Users/ryan/WebstormProjects/add-to-calendar-rn add package.json package-lock.json app.json
git -C /Users/ryan/WebstormProjects/add-to-calendar-rn commit -m "feat: add expo-apple-authentication + Sign in with Apple entitlement"
```

---

## Task 6: Add the Edge Function endpoints to config

**Files:**
- Modify: `/Users/ryan/WebstormProjects/add-to-calendar-rn/src/config.ts`

- [ ] **Step 1: Add the two endpoints**

In `src/config.ts`, extend `EDGE_FUNCTIONS` so it reads:

```ts
  EDGE_FUNCTIONS: {
    PROCESS_TEXT:
      'https://pahcnlwgtghsctbnedhx.supabase.co/functions/v1/process-text',
    PROCESS_IMAGE:
      'https://pahcnlwgtghsctbnedhx.supabase.co/functions/v1/process-image',
    DELETE_ACCOUNT:
      'https://pahcnlwgtghsctbnedhx.supabase.co/functions/v1/delete-account',
    APPLE_LINK:
      'https://pahcnlwgtghsctbnedhx.supabase.co/functions/v1/apple-link',
  },
```

Also extend the fork comment at the top: after the existing `EDGE_FUNCTIONS.PROCESS_TEXT` mention, note that forks must also deploy `apple-link` and `delete-account`.

- [ ] **Step 2: Verify**

Run: `cd /Users/ryan/WebstormProjects/add-to-calendar-rn && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git -C /Users/ryan/WebstormProjects/add-to-calendar-rn add src/config.ts
git -C /Users/ryan/WebstormProjects/add-to-calendar-rn commit -m "feat: add delete-account + apple-link endpoints to config"
```

---

## Task 7: Apple sign-in, availability, and delete in `auth.ts`

**Files:**
- Modify: `/Users/ryan/WebstormProjects/add-to-calendar-rn/src/services/auth.ts`

- [ ] **Step 1: Add imports**

At the top of `src/services/auth.ts`, add below the existing imports:

```ts
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
```

- [ ] **Step 2: Add the three functions**

Append to `src/services/auth.ts` (after `signOut`):

```ts
/**
 * Whether native Sign in with Apple is available (iOS 13+; false on Android,
 * web, and simulators without an Apple ID).
 */
export function isAppleSignInAvailable(): Promise<boolean> {
  return AppleAuthentication.isAvailableAsync();
}

/**
 * Native Sign in with Apple → Supabase session. Mirrors useGoogleSignIn but is
 * a one-shot async call (no expo-auth-session request/response hook needed).
 * After sign-in, best-effort links the Apple authorizationCode to the backend
 * so the account can be revoked at deletion. User cancellation is swallowed.
 */
export async function signInWithApple(): Promise<void> {
  try {
    const rawNonce = Crypto.randomUUID();
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      rawNonce,
    );
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashedNonce,
    });
    if (!credential.identityToken) {
      throw new Error('No identity token returned from Apple');
    }
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
      nonce: rawNonce,
    });
    if (error) throw error;

    // Best-effort: store the Apple refresh token for later revocation.
    const accessToken = data.session?.access_token;
    if (accessToken && credential.authorizationCode) {
      try {
        await fetch(CONFIG.EDGE_FUNCTIONS.APPLE_LINK, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            apikey: CONFIG.SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ authorizationCode: credential.authorizationCode }),
        });
      } catch (linkErr) {
        console.warn('apple-link failed (revocation unavailable):', linkErr);
      }
    }
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return;
    throw e;
  }
}

/**
 * Permanently delete the signed-in user's account via the delete-account Edge
 * Function (revokes Apple tokens server-side, deletes data + auth user), then
 * signs out locally.
 */
export async function deleteAccount(accessToken: string): Promise<void> {
  const res = await fetch(CONFIG.EDGE_FUNCTIONS.DELETE_ACCOUNT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: CONFIG.SUPABASE_ANON_KEY,
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    let message = errText;
    try {
      message = JSON.parse(errText).error ?? errText;
    } catch {
      // not JSON
    }
    throw new Error(`Delete failed ${res.status}: ${message}`);
  }
  await supabase.auth.signOut();
}
```

- [ ] **Step 3: Verify**

Run: `cd /Users/ryan/WebstormProjects/add-to-calendar-rn && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git -C /Users/ryan/WebstormProjects/add-to-calendar-rn add src/services/auth.ts
git -C /Users/ryan/WebstormProjects/add-to-calendar-rn commit -m "feat: Apple sign-in, availability check, and account deletion in auth service"
```

---

## Task 8: Apple button + Delete account row in `settings.tsx`

**Files:**
- Modify: `/Users/ryan/WebstormProjects/add-to-calendar-rn/app/settings.tsx`

- [ ] **Step 1: Update imports**

Replace the react-native import line:

```ts
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
```

with (adds `useColorScheme`):

```ts
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
```

Replace the auth import line:

```ts
import { signOut, useAuth, useGoogleSignIn } from '../src/services/auth';
```

with:

```ts
import * as AppleAuthentication from 'expo-apple-authentication';
import {
  deleteAccount,
  isAppleSignInAvailable,
  signInWithApple,
  signOut,
  useAuth,
  useGoogleSignIn,
} from '../src/services/auth';
```

- [ ] **Step 2: Add availability state + delete handler**

Inside `export default function Settings()`, after the existing
`const [editing, setEditing] = useState(false);` line, add:

```ts
  const colorScheme = useColorScheme();
  const [appleAvailable, setAppleAvailable] = useState(false);
  useEffect(() => {
    isAppleSignInAvailable().then(setAppleAvailable);
  }, []);

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete account',
      'This permanently deletes your account. Your free monthly usage resets. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const token = auth.session?.access_token;
              if (!token) throw new Error('No active session');
              await deleteAccount(token);
            } catch (e) {
              Alert.alert('Delete failed', String((e as Error).message ?? e));
            }
          },
        },
      ],
    );
  };
```

- [ ] **Step 3: Render the Apple button above the ACCOUNT group**

Replace this block:

```tsx
      <SectionHeader theme={theme}>ACCOUNT</SectionHeader>
      <Group theme={theme}>
        {auth.user ? (
```

with:

```tsx
      <SectionHeader theme={theme}>ACCOUNT</SectionHeader>
      {!auth.user && appleAvailable && (
        <View style={{ marginBottom: spacing.sm }}>
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={
              colorScheme === 'dark'
                ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
            }
            cornerRadius={radius.md}
            style={{ width: '100%', height: 48 }}
            onPress={async () => {
              try {
                await signInWithApple();
              } catch (e) {
                Alert.alert('Apple sign-in failed', String((e as Error).message ?? e));
              }
            }}
          />
        </View>
      )}
      <Group theme={theme}>
        {auth.user ? (
```

- [ ] **Step 4: Add the Delete account row after Sign out**

Replace this block (the signed-in branch):

```tsx
            <Hairline theme={theme} />
            <Pressable
              onPress={async () => {
                await signOut();
              }}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.fill }]}
            >
              <Text style={{ color: theme.systemRed, fontSize: 17, flex: 1 }}>Sign out</Text>
            </Pressable>
          </>
```

with:

```tsx
            <Hairline theme={theme} />
            <Pressable
              onPress={async () => {
                await signOut();
              }}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.fill }]}
            >
              <Text style={{ color: theme.systemBlue, fontSize: 17, flex: 1 }}>Sign out</Text>
            </Pressable>
            <Hairline theme={theme} />
            <Pressable
              onPress={handleDeleteAccount}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.fill }]}
            >
              <Text style={{ color: theme.systemRed, fontSize: 17, flex: 1 }}>Delete account</Text>
            </Pressable>
          </>
```

(Sign out becomes blue/standard so the red is reserved for the destructive Delete action.)

- [ ] **Step 5: Verify**

Run: `cd /Users/ryan/WebstormProjects/add-to-calendar-rn && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git -C /Users/ryan/WebstormProjects/add-to-calendar-rn add app/settings.tsx
git -C /Users/ryan/WebstormProjects/add-to-calendar-rn commit -m "feat: Sign in with Apple button + Delete account row in Settings"
```

---

## Task 9: README — App Store readiness section

**Files:**
- Modify: `/Users/ryan/WebstormProjects/add-to-calendar-rn/README.md`

- [ ] **Step 1: Add the section**

Append to `README.md` (or place near the existing "App Store readiness" notes if one exists):

```markdown
## App Store readiness — auth & account deletion

This app offers **Sign in with Apple** and **Google sign-in** (Guideline 4.8:
when you offer a social login, you must also offer Sign in with Apple — Apple
removed the "exclusively" wording, so an optional Google login + BYOK does not
exempt you). It also offers **in-app account deletion** (Guideline 5.1.1(v)).

### One-time setup (maintainer / fork)
1. **Apple Developer:** enable the "Sign in with Apple" capability on App ID
   `com.addtocalendar.rn`, and create a **Sign in with Apple key** (Keys → +);
   note the **Key ID** + your **Team ID**, and download the `.p8`.
2. **Supabase → Authentication → Providers → Apple:** enable it and add bundle
   ID `com.addtocalendar.rn` to the authorized client IDs.
3. **Supabase secrets** (for the Edge Functions):
   `supabase secrets set APPLE_CLIENT_ID=com.addtocalendar.rn APPLE_TEAM_ID=<team> APPLE_KEY_ID=<key> APPLE_PRIVATE_KEY="$(cat AuthKey_XXXX.p8)"`
4. Apply the migration and deploy:
   `supabase db push` (or apply `apple_refresh_tokens`), then
   `supabase functions deploy apple-link delete-account`.

### App Review notes (paste into App Store Connect)
> Sign-in is optional. Core functionality (extract events from text/images, add
> to calendar) works with no account by using your own OpenAI API key (Settings
> → OpenAI API key). We offer both Sign in with Apple and Google. Account
> deletion is in Settings → Delete account (signed in), which permanently
> deletes the account and revokes Apple tokens. Reviewer test key (BYOK):
> `<provide a low-cap OpenAI key here>`.

### Known follow-up
- Apple token revocation is implemented (delete-account → `/auth/revoke`); no
  Google revocation is required (the Google token is discarded at sign-in and
  never stored).
```

- [ ] **Step 2: Commit**

```bash
git -C /Users/ryan/WebstormProjects/add-to-calendar-rn add README.md
git -C /Users/ryan/WebstormProjects/add-to-calendar-rn commit -m "docs: App Store readiness — Apple sign-in, account deletion, review notes"
```

> **Client phase done.** Open a PR for `feat/sign-in-with-apple`.

---

## Task 10: Provisioning + end-to-end verification (user-run)

Code can't self-verify Apple/Supabase config or deploy to prod. Do these in order.

- [ ] **Step 1: Apple Developer** — enable "Sign in with Apple" on App ID `com.addtocalendar.rn`; create a Sign in with Apple `.p8` key; record Key ID + Team ID; download the `.p8`.
- [ ] **Step 2: Supabase Apple provider** — enable it; add `com.addtocalendar.rn` to authorized client IDs.
- [ ] **Step 3: Set secrets** —
  `supabase secrets set APPLE_CLIENT_ID=com.addtocalendar.rn APPLE_TEAM_ID=<team> APPLE_KEY_ID=<key> APPLE_PRIVATE_KEY="$(cat AuthKey_XXXX.p8)"`
- [ ] **Step 4: Migration + deploy** (from `../add-to-calendar`) —
  apply the `apple_refresh_tokens` migration, then
  `npx supabase functions deploy apple-link delete-account`.
- [ ] **Step 5: Native rebuild** (from `add-to-calendar-rn`) —
  `npx expo prebuild` then `npx expo run:ios`.
- [ ] **Step 6: Verify sign-in** — Settings → Sign in with Apple → consent →
  "Signed in as <email>". Confirm a backend text extraction works. In Supabase,
  confirm a row exists in `apple_refresh_tokens` for the user.
- [ ] **Step 7: Verify deletion (Apple)** — Settings → Delete account → confirm.
  App returns to signed-out. In Supabase, confirm the `auth.users`,
  `usage_tracking`, and `apple_refresh_tokens` rows are gone. On the device,
  Settings app → Apple ID → Sign in with Apple → the app should no longer be
  listed (revocation worked).
- [ ] **Step 8: Verify deletion (Google)** — sign in with Google, Delete
  account, confirm the user + usage rows are gone (no Apple row / revoke).
- [ ] **Step 9: Regression** — Google sign-in, BYOK, share-to, and the calendar
  flows still work; the Apple button is hidden where unavailable.

---

## Self-review notes (author)

- **Spec coverage:** Apple sign-in (T5–T8) ✓; account deletion (T2,T4,T7,T8) ✓;
  Apple token revocation (T1,T3,T4,T7) ✓; Google-no-revocation (T4 logic) ✓;
  email-only scope (T7) ✓; iOS-only button (T8 `appleAvailable`) ✓; review
  notes (T9) ✓; setup steps (T9,T10) ✓.
- **Type consistency:** `buildAppleClientSecret(config?)` defined T1, called
  no-arg in T3/T4; `signInWithApple`/`deleteAccount`/`isAppleSignInAvailable`
  defined T7, used T8; `EDGE_FUNCTIONS.APPLE_LINK`/`.DELETE_ACCOUNT` defined T6,
  used T7. Consistent.
- **No placeholders** except the intentional reviewer-test-key blank in the
  README review note (filled by the user at submission).
```
