# process-image backend + RN client wiring — Design

**Date:** 2026-05-21
**Status:** Approved (design), pending implementation plan

## Goal

Let signed-in (non-BYOK) users extract calendar events from **images** via the
shared Supabase backend, mirroring the existing text flow. Today image
extraction is BYOK-only because the backend has no image endpoint; this adds a
`process-image` Edge Function and wires the RN app to use it.

## Context

This feature spans **two git repos**:

| Repo | GitHub | Role | Changes |
|------|--------|------|---------|
| `add-to-calendar` | `ryoshumei/add-to-calendar` | Shared backend + Chrome extension | New Edge Function |
| `add-to-calendar-rn` | `ryoshumei/add-to-calendar-rn` | RN client (this repo) | Client wiring |

Current state:
- Backend `process-text/index.ts`: JWT auth → `X-Extension-Version` check →
  `checkAndIncrementUsage` (50/month via `usage_tracking`, service-role key) →
  OpenAI call → returns `{ eventDetails: { events }, usage }`.
- `_shared/llm-prompt.ts`: `LLM_CONFIG` (model `gpt-4.1-mini`, prompt builders).
- The **Chrome extension is text-only** — no image handling. `process-image`
  is a new capability used (for now) only by the RN app.
- RN `src/services/llm.ts`: `extractEventsFromTextViaBackend` (backend) and
  `extractEventsFromImage` (BYOK direct to OpenAI). Home screen gates image
  extraction behind `canExtractImage = canUseBYOK`.

## Decisions

1. **Usage metering:** 1 image = 1 request against the **same** 50/month pool
   as text. No schema change; reuse `checkAndIncrementUsage` unchanged.
2. **Image transport:** base64 data URL in the JSON request body (mirrors the
   current BYOK flow). No Supabase Storage.
3. **Client-side resize:** add `expo-image-manipulator`; resize to max ~1600px,
   JPEG quality ~0.7 before base64 to keep payloads small and OpenAI cost down.
4. **Code structure:** standalone `process-image` function that duplicates the
   auth/usage/version boilerplate from `process-text`, rather than refactoring
   shared logic into `_shared/`. Rationale: `process-text` is in production
   serving the Chrome extension; an isolated new function means zero risk to
   the working path. Duplication is an accepted trade-off; DRY refactor is a
   possible follow-up if a third function appears.

## Architecture

```
add-to-calendar (backend repo)            add-to-calendar-rn (this repo)
└─ supabase/functions/                     └─ src/services/llm.ts
   ├─ process-image/index.ts  [NEW]           + extractEventsFromImageViaBackend()  [NEW]
   └─ _shared/llm-prompt.ts                    + resizeForUpload() helper inline      [NEW]
      + buildImageRequestBody()  [EDIT]       src/config.ts
      + [functions.process-image]  [EDIT]       + EDGE_FUNCTIONS.PROCESS_IMAGE url    [EDIT]
                                            app/index.tsx
                                              + image routing: backend fallback     [EDIT]
                                            package.json
                                              + expo-image-manipulator             [EDIT]
```

## Backend design

### `supabase/functions/process-image/index.ts` (new)

Same scaffold as `process-text`, differing only in input and the OpenAI call:

- **CORS / OPTIONS:** identical.
- **Auth:** identical — require `Authorization` header, `supabase.auth.getUser()`,
  throw `Unauthorized` (401) on failure.
- **Version check:** identical — `X-Extension-Version` vs `MIN_SUPPORTED_VERSION`.
- **Usage:** identical — `checkAndIncrementUsage(user.id, serviceRoleKey)` before
  processing; 1 increment per image; limit-exceeded throws (same message style).
- **Body:** `{ image }` where `image` is a base64 data URL
  (`data:image/jpeg;base64,…`). Throw `image is required` (400) if missing.
- **OpenAI:** vision request via `_shared` builder (below); model `gpt-4.1-mini`,
  `response_format: { type: 'json_object' }`.
- **Validation:** reuse the same `validateEventResponse` / `validateSingleEventDetails`
  logic (copied into this function, per the standalone decision).
- **Response:** `{ eventDetails: { events }, usage }` — identical shape to
  `process-text`, so the client parses both the same way.

### `supabase/functions/_shared/llm-prompt.ts` (edit)

Add an image request builder alongside the text one:

```ts
buildImageRequestBody(imageDataUrl: string, currentDateTime: string): object {
  return {
    model: this.model,
    messages: [
      { role: 'system', content: this.buildSystemPrompt(currentDateTime) },
      {
        role: 'user',
        content: [
          { type: 'text', text: `Time: ${currentDateTime}\nExtract all calendar events visible in this image.` },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
    temperature: this.temperature,
    top_p: this.top_p,
    response_format: { type: 'json_object' },
  };
}
```

Reuses the existing `buildSystemPrompt` so text and image extraction stay
behaviorally consistent.

### `supabase/config.toml` (edit)

```toml
[functions.process-image]
verify_jwt = true
```

Deploy: `npx supabase functions deploy process-image`. Add a
`deploy:backend:image` npm script in the backend repo for convenience.

## Client design

### `src/config.ts` (edit)

```ts
EDGE_FUNCTIONS: {
  PROCESS_TEXT:  '…/functions/v1/process-text',
  PROCESS_IMAGE: '…/functions/v1/process-image',  // NEW
}
```

### resize helper (new) — `expo-image-manipulator`

`resizeForUpload(uri): Promise<string>` — inline in `src/services/llm.ts`
(colocated with the existing `guessMime` helper). Resize to max 1600px on the
longest edge, JPEG quality 0.7, return a new local URI. New native module: add
to top-level `package.json` → `npx expo install expo-image-manipulator` →
`pod install` → iOS rebuild. (Same autolinking class as the earlier
`expo-application` fix — flagged so the rebuild is expected.)

### `src/services/llm.ts` (edit)

`extractEventsFromImageViaBackend(accessToken, imageUri): Promise<ExtractionResult>`:
1. `resizeForUpload(imageUri)` → resized URI.
2. `FileSystem.readAsStringAsync(..., Base64)` + `guessMime` → data URL (reuse
   existing helpers).
3. POST `{ image: dataUrl }` to `PROCESS_IMAGE` with the same headers as the
   text backend call (`Authorization`, `apikey`, `X-Extension-Version`).
4. Parse `{ eventDetails: { events }, usage }` → `ExtractionResult`.

### `app/index.tsx` (edit)

- `canExtractImage = canUseBYOK || canUseBackend` (was BYOK-only).
- `handleExtract` image branch — BYOK first, backend fallback:
  - BYOK set → `extractEventsFromImage` (unchanged, direct OpenAI).
  - else signed-in → `extractEventsFromImageViaBackend`, then `setUsage` from
    the result.
- Remove the "API key required for images" alert (signed-in users can now
  extract images). Keep the "sign in or add a key" guard for the
  fully-unconfigured case.

## Response contract (both endpoints)

```
200 → { eventDetails: { events: EventDetails[] }, usage: { usageCount, limit, yearMonth } }
400 → { error, details }   (missing image / invalid body / parse failure / limit exceeded)
401 → { error: 'Unauthorized' }
```

## Error handling

- Missing/invalid image → 400 with `image is required`.
- Limit exceeded → thrown in `checkAndIncrementUsage` (400), surfaced in-app as
  the backend error message (existing client behavior).
- OpenAI failure / unparseable JSON → 400 (same as process-text).
- Usage is incremented **before** the OpenAI call (matches process-text); a
  failed OpenAI call still counts. Accepted, consistent with current behavior.

## Testing

- **Backend:** `supabase functions serve process-image`; curl with a real user
  JWT + small base64 image → assert `events` + `usage`; second call increments
  usage; missing image → 400; missing auth → 401.
- **Client:** `npx tsc --noEmit`; on-device: signed-in (no key) pick image →
  events appear + counter ticks; BYOK still goes direct; limit-exceeded path
  surfaces the backend error.
- **Regression:** `process-text` and the Chrome extension untouched — that
  function is not redeployed.

## Out of scope

- Chrome extension image support (stays text-only).
- Separate image quota / weighted metering (using shared pool, 1:1).
- Supabase Storage upload path (using base64-in-body).
- DRY refactor of shared auth/usage into `_shared/` (possible later follow-up).

## Constraints

- Must not change or redeploy `process-text` — the Chrome extension depends on
  it. All backend changes are additive (new function + new `_shared` method +
  new `config.toml` block).
- Anon key and Supabase project are shared; backend response shape must stay
  compatible with both clients (it does — `process-image` is RN-only and mirrors
  the text shape).
