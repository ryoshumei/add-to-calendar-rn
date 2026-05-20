# process-image Backend + RN Client Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `process-image` Supabase Edge Function (shared backend) so signed-in users can extract calendar events from images, and wire the RN app to use it.

**Architecture:** A standalone `process-image` Edge Function mirrors `process-text`'s auth + usage-tracking boilerplate, differing only in that it accepts a base64 image and sends an OpenAI vision request. The RN client resizes the image (expo-image-manipulator), base64-encodes it, and posts it to the new endpoint; the Home screen routes image extraction to the backend for signed-in users (BYOK still goes direct to OpenAI).

**Tech Stack:** Supabase Edge Functions (Deno), OpenAI `gpt-4.1-mini` vision, React Native / Expo SDK 52, TypeScript, expo-image-manipulator, expo-file-system.

**Two repos:**
- **Backend:** `/Users/ryan/WebstormProjects/add-to-calendar` (GitHub `ryoshumei/add-to-calendar`) — Tasks 1–4
- **Client:** `/Users/ryan/WebstormProjects/add-to-calendar-rn` (this repo) — Tasks 5–9

**Constraint:** Do NOT modify or redeploy `process-text`. All backend changes are additive (new function + new `_shared` method + new `config.toml` block). The Chrome extension must remain unaffected.

---

## File Structure

**Backend repo (`add-to-calendar`):**
- Modify: `supabase/functions/_shared/llm-prompt.ts` — add `buildImageRequestBody()`
- Create: `supabase/functions/_shared/llm-prompt.test.ts` — Deno test for the new builder
- Create: `supabase/functions/process-image/index.ts` — the new Edge Function
- Modify: `supabase/config.toml` — add `[functions.process-image]`
- Modify: `package.json` — add `deploy:backend:image` script

**Client repo (`add-to-calendar-rn`):**
- Modify: `package.json` — add `expo-image-manipulator`
- Modify: `src/config.ts` — add `EDGE_FUNCTIONS.PROCESS_IMAGE`
- Modify: `src/services/llm.ts` — add `resizeForUpload()` + `extractEventsFromImageViaBackend()`
- Modify: `app/index.tsx` — route image extraction to backend for signed-in users

---

## Task 1: Add `buildImageRequestBody` to shared prompt config (TDD)

**Repo:** `add-to-calendar`

**Files:**
- Modify: `supabase/functions/_shared/llm-prompt.ts`
- Test: `supabase/functions/_shared/llm-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/llm-prompt.test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { LLM_CONFIG } from "./llm-prompt.ts";

Deno.test("buildImageRequestBody builds a vision request with json_object format", () => {
  const dataUrl = "data:image/jpeg;base64,QUJD";
  const body = LLM_CONFIG.buildImageRequestBody(dataUrl, "2026-05-21 10:00:00") as {
    model: string;
    response_format: { type: string };
    messages: Array<{ role: string; content: unknown }>;
  };

  assertEquals(body.model, "gpt-4.1-mini");
  assertEquals(body.response_format.type, "json_object");
  assertEquals(body.messages.length, 2);
  assertEquals(body.messages[0].role, "system");

  const userMsg = body.messages[1] as {
    role: string;
    content: Array<{ type: string; image_url?: { url: string }; text?: string }>;
  };
  assertEquals(userMsg.role, "user");
  assertEquals(userMsg.content[0].type, "text");
  assertEquals(userMsg.content[1].type, "image_url");
  assertEquals(userMsg.content[1].image_url?.url, dataUrl);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd /Users/ryan/WebstormProjects/add-to-calendar && deno test supabase/functions/_shared/llm-prompt.test.ts
```
Expected: FAIL — `LLM_CONFIG.buildImageRequestBody is not a function`.

(If `deno` is not installed: `brew install deno`.)

- [ ] **Step 3: Implement `buildImageRequestBody`**

In `supabase/functions/_shared/llm-prompt.ts`, add this method to the `LLM_CONFIG` object, immediately after `buildRequestBody` (before the closing `};`):

```ts
  /**
   * Build the request body for an OpenAI vision (image) extraction call.
   */
  buildImageRequestBody(imageDataUrl: string, currentDateTime: string): object {
    return {
      model: this.model,
      messages: [
        {
          role: 'system',
          content: this.buildSystemPrompt(currentDateTime),
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Time: ${currentDateTime}\nExtract all calendar events visible in this image (poster, screenshot, schedule, invitation, etc.).`,
            },
            {
              type: 'image_url',
              image_url: { url: imageDataUrl },
            },
          ],
        },
      ],
      temperature: this.temperature,
      top_p: this.top_p,
      response_format: { type: 'json_object' },
    };
  },
```

Note: the existing `buildSystemPrompt` says "extracts event details from text" — that wording is harmless for images (the model still returns the same JSON event shape). Leave it unchanged to avoid touching the text path's behavior.

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
cd /Users/ryan/WebstormProjects/add-to-calendar && deno test supabase/functions/_shared/llm-prompt.test.ts
```
Expected: PASS — `ok | 1 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
cd /Users/ryan/WebstormProjects/add-to-calendar
git add supabase/functions/_shared/llm-prompt.ts supabase/functions/_shared/llm-prompt.test.ts
git commit -m "feat(backend): add buildImageRequestBody for vision extraction"
```

---

## Task 2: Create the `process-image` Edge Function

**Repo:** `add-to-calendar`

**Files:**
- Create: `supabase/functions/process-image/index.ts`

- [ ] **Step 1: Create the function file**

Create `supabase/functions/process-image/index.ts` with the full contents below. This mirrors `process-text/index.ts`, changing only the request body (`image` instead of `selectedText`), the OpenAI call (`buildImageRequestBody`), and log/error wording.

```ts
// Supabase Edge Function: process-image
// Processes an image with OpenAI vision to extract calendar event details

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { LLM_CONFIG } from '../_shared/llm-prompt.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-extension-version',
}

// Minimum supported client version (update when making breaking changes)
const MIN_SUPPORTED_VERSION = '1.0.0'

interface EventDetails {
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  location?: string;
}

interface EventResponse {
  events: EventDetails[];
}

interface UsageInfo {
  usageCount: number;
  limit: number;
  yearMonth: string;
}

const MONTHLY_LIMIT = 50;

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get user from auth header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('Missing authorization header')
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    // Verify user authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      throw new Error('Unauthorized')
    }

    // Check client version for compatibility
    const extensionVersion = req.headers.get('X-Extension-Version') || 'unknown'
    console.log(`Processing image for user: ${user.email}, client version: ${extensionVersion}`)

    if (extensionVersion !== 'unknown' && !isVersionSupported(extensionVersion)) {
      throw new Error(`Client version ${extensionVersion} is no longer supported. Please update to the latest version.`)
    }

    // Check and increment usage - must be done before processing
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!serviceRoleKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured')
    }

    const usageInfo = await checkAndIncrementUsage(user.id, serviceRoleKey)

    // Get request body
    const { image } = await req.json()
    if (!image || typeof image !== 'string') {
      throw new Error('image is required')
    }

    // Get OpenAI API key from environment
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY not configured')
    }

    // Process with OpenAI vision
    const eventDetails = await processImageWithOpenAI(image, openaiApiKey)

    return new Response(
      JSON.stringify({
        eventDetails,
        usage: usageInfo
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error) {
    console.error('Error processing image:', error)

    return new Response(
      JSON.stringify({
        error: error.message || 'Internal server error',
        details: error.toString()
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: error.message === 'Unauthorized' ? 401 : 400
      }
    )
  }
})

/**
 * Process an image with the OpenAI vision API to extract event details.
 */
async function processImageWithOpenAI(imageDataUrl: string, apiKey: string): Promise<EventResponse> {
  const now = new Date()
  const currentDateTime = now.toLocaleString()

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(LLM_CONFIG.buildImageRequestBody(imageDataUrl, currentDateTime))
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error?.message || 'OpenAI API request failed')
    }

    const data = await response.json()
    console.log('Raw GPT response:', data.choices[0].message.content)

    try {
      let parsed = JSON.parse(data.choices[0].message.content.trim())

      // Backward compatibility: wrap single event in events array
      if (!parsed.events && parsed.title) {
        parsed = { events: [parsed] }
      }

      validateEventResponse(parsed)
      return parsed
    } catch (parseError) {
      console.error('JSON Parse Error:', parseError)
      console.error('Raw content:', data.choices[0].message.content)
      throw new Error('Failed to parse GPT response as JSON')
    }
  } catch (error) {
    console.error('Error calling OpenAI API:', error)
    throw new Error('Failed to process image: ' + error.message)
  }
}

/**
 * Validate event response structure (wrapper with events array)
 */
function validateEventResponse(response: EventResponse) {
  if (!response || !Array.isArray(response.events) || response.events.length === 0) {
    throw new Error('Invalid response: Expected object with events array containing at least one event')
  }

  response.events.forEach((event, index) => {
    validateSingleEventDetails(event, index)
  })
}

/**
 * Validate single event details structure and content
 */
function validateSingleEventDetails(details: EventDetails, index: number = 0) {
  const required = ['title', 'startTime', 'endTime']
  const missing = required.filter(field => !details[field as keyof EventDetails])

  if (missing.length > 0) {
    throw new Error(`Event ${index + 1}: Missing required fields: ${missing.join(', ')}`)
  }

  const dateTimeRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/
  if (!dateTimeRegex.test(details.startTime) || !dateTimeRegex.test(details.endTime)) {
    throw new Error(`Event ${index + 1}: Invalid datetime format`)
  }

  if (new Date(details.startTime) >= new Date(details.endTime)) {
    throw new Error(`Event ${index + 1}: Start time must be before end time`)
  }
}

/**
 * Check and increment usage for a user.
 * Returns current usage info and throws if limit exceeded.
 */
async function checkAndIncrementUsage(userId: string, serviceRoleKey: string): Promise<UsageInfo> {
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )

  const now = new Date()
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const { data: existingUsage, error: fetchError } = await supabaseAdmin
    .from('usage_tracking')
    .select('usage_count')
    .eq('user_id', userId)
    .eq('year_month', yearMonth)
    .single()

  if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = not found
    console.error('Error fetching usage:', fetchError)
    throw new Error('Failed to check usage limit')
  }

  const currentUsage = existingUsage?.usage_count || 0

  if (currentUsage >= MONTHLY_LIMIT) {
    throw new Error(`Monthly limit exceeded. You have used ${currentUsage}/${MONTHLY_LIMIT} requests this month.`)
  }

  const newCount = currentUsage + 1

  const { error: upsertError } = await supabaseAdmin
    .from('usage_tracking')
    .upsert({
      user_id: userId,
      year_month: yearMonth,
      usage_count: newCount,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'user_id,year_month'
    })
    .select()
    .single()

  if (upsertError) {
    console.error('Error updating usage:', upsertError)
    throw new Error('Failed to update usage tracking: ' + upsertError.message)
  }

  return {
    usageCount: newCount,
    limit: MONTHLY_LIMIT,
    yearMonth
  }
}

function parseVersion(v: string): number[] {
  return v.split('.').map(n => parseInt(n, 10) || 0)
}

function compareVersions(a: string, b: string): number {
  const vA = parseVersion(a)
  const vB = parseVersion(b)

  for (let i = 0; i < 3; i++) {
    if ((vA[i] || 0) > (vB[i] || 0)) return 1
    if ((vA[i] || 0) < (vB[i] || 0)) return -1
  }
  return 0
}

function isVersionSupported(version: string): boolean {
  return compareVersions(version, MIN_SUPPORTED_VERSION) >= 0
}
```

- [ ] **Step 2: Type-check the function with Deno**

Run:
```bash
cd /Users/ryan/WebstormProjects/add-to-calendar && deno check supabase/functions/process-image/index.ts
```
Expected: no type errors (it may download remote deps on first run).

- [ ] **Step 3: Commit**

```bash
cd /Users/ryan/WebstormProjects/add-to-calendar
git add supabase/functions/process-image/index.ts
git commit -m "feat(backend): add process-image Edge Function"
```

---

## Task 3: Register the function in config + add deploy script

**Repo:** `add-to-calendar`

**Files:**
- Modify: `supabase/config.toml`
- Modify: `package.json`

- [ ] **Step 1: Add the function block to `config.toml`**

In `supabase/config.toml`, immediately after the existing `[functions.process-text.env]` block (end of file), append:

```toml

[functions.process-image]
verify_jwt = true

# Environment variables for local development
# For production, set these via: supabase secrets set KEY=value
[functions.process-image.env]
# OPENAI_API_KEY should be set via: supabase secrets set OPENAI_API_KEY=your_key
```

- [ ] **Step 2: Add the deploy script to `package.json`**

In `package.json`, in the `"scripts"` block, add this line after the existing `"deploy:backend"` line:

```json
    "deploy:backend:image": "npx supabase functions deploy process-image",
```

(Ensure the preceding line ends with a comma so the JSON stays valid.)

- [ ] **Step 3: Verify package.json is valid JSON**

Run:
```bash
cd /Users/ryan/WebstormProjects/add-to-calendar && node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('valid')"
```
Expected: `valid`.

- [ ] **Step 4: Commit**

```bash
cd /Users/ryan/WebstormProjects/add-to-calendar
git add supabase/config.toml package.json
git commit -m "chore(backend): register process-image function + deploy script"
```

---

## Task 4: Deploy and verify the backend endpoint

**Repo:** `add-to-calendar`

This task deploys the new function (additive — does NOT touch `process-text`) and verifies it.

- [ ] **Step 1: Ensure the Supabase access token is set**

The deploy needs a Supabase access token (get one at <https://supabase.com/dashboard/account/tokens>). In your shell:
```bash
export SUPABASE_ACCESS_TOKEN=<your-token>
```

- [ ] **Step 2: Deploy only the new function**

Run:
```bash
cd /Users/ryan/WebstormProjects/add-to-calendar && npm run deploy:backend:image
```
Expected: `Deployed Function process-image` (or similar success). `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are already configured as project secrets (used by `process-text`), so no new secrets are needed.

- [ ] **Step 3: Verify unauthenticated access is rejected**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://pahcnlwgtghsctbnedhx.supabase.co/functions/v1/process-image
```
Expected: `401` (JWT verification rejects the request — `verify_jwt = true`).

- [ ] **Step 4: Verify the happy path with a real user token + image (manual)**

You need a valid **user** access token. Easiest source: sign in on the RN app, then in `src/services/auth.ts`'s `useAuth` effect temporarily `console.log(data.session?.access_token)` — or grab it from a Supabase sign-in. Then:

```bash
# Create a tiny test data URL from any local jpg:
B64=$(base64 -i /path/to/a/small-event-poster.jpg)
curl -s -X POST \
  https://pahcnlwgtghsctbnedhx.supabase.co/functions/v1/process-image \
  -H "Authorization: Bearer <USER_ACCESS_TOKEN>" \
  -H "apikey: <SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -H "X-Extension-Version: 1.0.0" \
  -d "{\"image\":\"data:image/jpeg;base64,$B64\"}" | python3 -m json.tool
```
Expected: JSON with `eventDetails.events` (array of events) and `usage` (`usageCount`, `limit: 50`, `yearMonth`). Run it twice and confirm `usageCount` increments by 1 each call.

- [ ] **Step 5: Push the backend branch**

```bash
cd /Users/ryan/WebstormProjects/add-to-calendar && git push
```

---

## Task 5: Add `expo-image-manipulator` to the client

**Repo:** `add-to-calendar-rn`

**Files:**
- Modify: `package.json` (via `expo install`)
- Modify: `ios/` (via `pod install`)

- [ ] **Step 1: Install the library (SDK-pinned version)**

Run:
```bash
cd /Users/ryan/WebstormProjects/add-to-calendar-rn && npx expo install expo-image-manipulator
```
Expected: `package.json` gains `expo-image-manipulator` at the SDK-52-compatible version, and it is hoisted to top-level `node_modules/expo-image-manipulator`.

- [ ] **Step 2: Install the iOS native pod**

Run:
```bash
cd /Users/ryan/WebstormProjects/add-to-calendar-rn/ios && pod install
```
Expected: output includes `Installing ExpoImageManipulator` (this is the native module — like the earlier `expo-application` fix, it must be linked via pod install before use).

- [ ] **Step 3: Verify the pod is registered**

Run:
```bash
grep -i "ExpoImageManipulator" /Users/ryan/WebstormProjects/add-to-calendar-rn/ios/Podfile.lock | head -3
```
Expected: at least one `ExpoImageManipulator` line.

- [ ] **Step 4: Commit**

```bash
cd /Users/ryan/WebstormProjects/add-to-calendar-rn
git add package.json package-lock.json
git commit -m "build: add expo-image-manipulator for client-side image resize"
```

---

## Task 6: Add the PROCESS_IMAGE endpoint to config

**Repo:** `add-to-calendar-rn`

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: Add the endpoint**

In `src/config.ts`, replace the `EDGE_FUNCTIONS` block:

```ts
  EDGE_FUNCTIONS: {
    PROCESS_TEXT:
      'https://pahcnlwgtghsctbnedhx.supabase.co/functions/v1/process-text',
  },
```

with:

```ts
  EDGE_FUNCTIONS: {
    PROCESS_TEXT:
      'https://pahcnlwgtghsctbnedhx.supabase.co/functions/v1/process-text',
    PROCESS_IMAGE:
      'https://pahcnlwgtghsctbnedhx.supabase.co/functions/v1/process-image',
  },
```

- [ ] **Step 2: Type-check**

Run:
```bash
cd /Users/ryan/WebstormProjects/add-to-calendar-rn && npx tsc --noEmit
```
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
cd /Users/ryan/WebstormProjects/add-to-calendar-rn
git add src/config.ts
git commit -m "feat: add PROCESS_IMAGE edge function url"
```

---

## Task 7: Add resize helper + backend image extraction to llm.ts

**Repo:** `add-to-calendar-rn`

**Files:**
- Modify: `src/services/llm.ts`

- [ ] **Step 1: Add the expo-image-manipulator import**

At the top of `src/services/llm.ts`, directly below the existing line `import * as FileSystem from 'expo-file-system';`, add:

```ts
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
```

- [ ] **Step 2: Add `resizeForUpload` and `extractEventsFromImageViaBackend`**

In `src/services/llm.ts`, find the `// ─── BYOK (direct OpenAI) ───` section header. Immediately ABOVE that header, add the new backend image function and the resize helper:

```ts
// ─── Backend image extraction (resize → base64 → process-image) ───────────

/**
 * Resize an image to a max edge of 1600px and JPEG-compress it, to keep the
 * upload payload (and OpenAI token cost) small. Returns a new local file URI.
 */
async function resizeForUpload(uri: string): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: 1600 });
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
  return result.uri;
}

export async function extractEventsFromImageViaBackend(
  accessToken: string,
  imageUri: string,
): Promise<ExtractionResult> {
  const resizedUri = await resizeForUpload(imageUri);
  const base64 = await FileSystem.readAsStringAsync(resizedUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const dataUrl = `data:image/jpeg;base64,${base64}`;

  const res = await fetch(CONFIG.EDGE_FUNCTIONS.PROCESS_IMAGE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'X-Extension-Version': CONFIG.APP.VERSION,
      apikey: CONFIG.SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ image: dataUrl }),
  });

  if (!res.ok) {
    const errText = await res.text();
    let message = errText;
    try {
      const j = JSON.parse(errText);
      message = j.error ?? errText;
    } catch {
      // not JSON
    }
    throw new Error(`Backend error ${res.status}: ${message}`);
  }

  const data = await res.json();
  const events: CalendarEvent[] =
    data?.eventDetails?.events ??
    data?.events ??
    (data?.eventDetails ? [data.eventDetails] : []);
  return { events, usage: data?.usage };
}

```

Note: `resizeForUpload` always outputs JPEG, so the data URL mime is hard-coded `image/jpeg` (no need for `guessMime` here).

- [ ] **Step 3: Type-check**

Run:
```bash
cd /Users/ryan/WebstormProjects/add-to-calendar-rn && npx tsc --noEmit
```
Expected: no output (success). If it errors on `ImageManipulator`/`SaveFormat` exports, confirm Task 5 installed the package.

- [ ] **Step 4: Commit**

```bash
cd /Users/ryan/WebstormProjects/add-to-calendar-rn
git add src/services/llm.ts
git commit -m "feat: backend image extraction via process-image with client resize"
```

---

## Task 8: Route image extraction to the backend on the Home screen

**Repo:** `add-to-calendar-rn`

**Files:**
- Modify: `app/index.tsx`

- [ ] **Step 1: Import the new function**

In `app/index.tsx`, update the import from `../src/services/llm` to include `extractEventsFromImageViaBackend`:

```ts
import {
  extractEventsFromImage,
  extractEventsFromImageViaBackend,
  extractEventsFromText,
  extractEventsFromTextViaBackend,
  type CalendarEvent,
  type UsageInfo,
} from '../src/services/llm';
```

- [ ] **Step 2: Allow image extraction for signed-in users**

Find:
```ts
  const canExtractImage = canUseBYOK; // backend doesn't support images yet
```
Replace with:
```ts
  const canExtractImage = canUseBYOK || canUseBackend;
```

- [ ] **Step 3: Update the "needs a key" guard for images**

Find:
```ts
    if (imageUri && !canExtractImage) {
      return Alert.alert(
        'API key required for images',
        'Image extraction needs your own OpenAI key. Add one in Settings, or remove the image and use text only.',
      );
    }
```
Replace with:
```ts
    if (imageUri && !canExtractImage) {
      return Alert.alert(
        'Sign in or add a key',
        'Image extraction needs Google sign-in (free, 50/month) or your own OpenAI key. Set up in Settings.',
      );
    }
```

- [ ] **Step 4: Route the image extraction call**

Find:
```ts
      if (imageUri && canUseBYOK) {
        collected.push(...(await extractEventsFromImage(apiKey!, imageUri)));
      }
```
Replace with:
```ts
      if (imageUri) {
        if (canUseBYOK) {
          collected.push(...(await extractEventsFromImage(apiKey!, imageUri)));
        } else if (canUseBackend) {
          const result = await extractEventsFromImageViaBackend(
            auth.session!.access_token,
            imageUri,
          );
          collected.push(...result.events);
          if (result.usage) setUsage(result.usage);
        }
      }
```

- [ ] **Step 5: Type-check**

Run:
```bash
cd /Users/ryan/WebstormProjects/add-to-calendar-rn && npx tsc --noEmit
```
Expected: no output (success).

- [ ] **Step 6: Commit**

```bash
cd /Users/ryan/WebstormProjects/add-to-calendar-rn
git add app/index.tsx
git commit -m "feat: route image extraction to backend for signed-in users"
```

---

## Task 9: Rebuild iOS and verify end-to-end

**Repo:** `add-to-calendar-rn`

- [ ] **Step 1: Rebuild the native app**

The new `expo-image-manipulator` pod must be linked into the binary (Metro hot reload won't do it). Run:
```bash
cd /Users/ryan/WebstormProjects/add-to-calendar-rn && npx expo run:ios
```
Expected: app builds and launches in the Simulator.

- [ ] **Step 2: Manual verification — signed-in backend image path**

In the running app:
1. Sign in with Google (no OpenAI key set), confirm the banner shows the request count.
2. Home → IMAGE → pick a photo of an event poster/screenshot → **Extract events**.
3. Expected: events appear, and the banner's monthly request count increments by 1.

- [ ] **Step 3: Manual verification — BYOK still goes direct**

1. Settings → add an OpenAI key.
2. Home → pick an image → Extract.
3. Expected: events appear; the signed-in request counter does NOT change (BYOK path is used because BYOK takes precedence).

- [ ] **Step 4: Manual verification — unconfigured guard**

1. Sign out and remove the OpenAI key.
2. Home → pick an image → Extract.
3. Expected: the "Sign in or add a key" alert appears (no crash).

- [ ] **Step 5: Push the client branch**

```bash
cd /Users/ryan/WebstormProjects/add-to-calendar-rn && git push
```

---

## Done When

- `process-image` is deployed; curl returns events + usage with a valid token, 401 without auth.
- `process-text` and the Chrome extension are untouched (not redeployed).
- RN app: signed-in users can extract events from images via the backend (counts 1/request against the 50/month pool); BYOK still goes direct to OpenAI; the unconfigured case shows a friendly alert instead of crashing.
- `npx tsc --noEmit` passes; both repos' changes are committed and pushed.
