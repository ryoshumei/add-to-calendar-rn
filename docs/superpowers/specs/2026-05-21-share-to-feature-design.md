# Share-to ("Add to Calendar" share target) — Design

**Date:** 2026-05-21
**Status:** Approved (design), pending implementation plan

## Goal

Let users share an image (poster, screenshot, invite) from any app — Photos,
Safari, Messages — into "Add to Calendar" via the iOS system share sheet. The
app opens on the Home screen with the shared image pre-filled, and the user
taps **Extract events** (the existing flow). This removes the need to switch to
the app and re-pick the image through the in-app picker.

## Context

- The app (Expo SDK 52, expo-router v4, RN 0.76, scheme `addtocalendar`, bundle
  id `com.addtocalendar.rn`) currently accepts images only via the in-app
  `expo-image-picker`. It is **not** a share target — verified: no share
  packages, no share config in `app.json`, no Share Extension in `ios/`.
- Extraction already supports a local image URI through two paths in
  `src/services/llm.ts`: `extractEventsFromImage` (BYOK) and
  `extractEventsFromImageViaBackend` (signed-in). The Home screen
  (`app/index.tsx`) routes BYOK-first, backend-fallback.
- **Research — `expo-share-intent` (achorein), v3.0+ supports SDK 52:** a
  config plugin + native module that registers an iOS Share Extension and
  Android intent filters. Shared images arrive via `useShareIntentContext()`
  as `shareIntent.files[]`, each with a local `path` (`file://…`), `mimeType`,
  `fileName`, `width/height` — a local URI that drops straight into the
  existing extraction flow. Requires `expo-linking` (already present) and
  `patch-package` (postinstall). iOS needs an **App Group** identifier.

## Decisions

1. **Content types:** images only (`NSExtensionActivationSupportsImageWithMaxCount: 1`,
   `image/*`). Text and URL sharing are out of scope for this iteration.
2. **Receive UX:** land on the existing Home screen with the image pre-filled;
   the user taps **Extract events**. No auto-extract, no separate landing UI.
3. **Platform:** iOS-first (matches the repo — no `android/` yet). The plugin
   still writes Android intent filters so a future Android build works.
4. **Integration approach (A):** `ShareIntentProvider` at the root; the Home
   screen reads `useShareIntentContext()` and pre-fills its image state.
   Chosen over a dedicated `app/shareintent.tsx` route (approach B) because we
   want to land directly on Home and the context hook works anywhere under the
   provider — no intermediate screen or cross-route file passing.
5. **Reuse extraction:** no new extraction logic. The shared `file://` path
   feeds the existing BYOK/backend paths.

## Architecture

```
Photos / Safari / Messages
        │  (system share sheet)
        ▼
"Add to Calendar" iOS Share Extension  ← new native target (expo-share-intent)
        │  writes image to App Group container, opens host app via scheme
        ▼
ShareIntentProvider (app/_layout.tsx)   ← exposes shareIntent.files[]
        │
        ▼
Home screen (app/index.tsx)             ← useShareIntentContext(): pre-fill imageUri
        │  user taps "Extract events"
        ▼
existing extract flow (BYOK or backend) in src/services/llm.ts
```

## Components / changes

### `app.json`
Add the plugin (alongside existing `expo-router`, `expo-image-picker`,
`expo-calendar` plugins):
```json
["expo-share-intent", {
  "iosActivationRules": { "NSExtensionActivationSupportsImageWithMaxCount": 1 },
  "iosShareExtensionName": "Add to Calendar",
  "iosAppGroupIdentifier": "group.com.addtocalendar.rn",
  "androidIntentFilters": ["image/*"]
}]
```

### `package.json`
- Add deps: `expo-share-intent`, `patch-package`.
- Add script: `"postinstall": "patch-package"` (library requirement).

### `app/_layout.tsx`
Wrap the tree in `<ShareIntentProvider>` as the outermost provider (around
`GestureHandlerRootView`).

### `app/index.tsx`
Add a `useShareIntentContext()` effect: when `hasShareIntent` and
`shareIntent.files?.[0]?.mimeType` starts with `image/`, call
`setImageUri(shareIntent.files[0].path)` then `resetShareIntent()`. If the app
was on another route (e.g. Settings) when the share arrived, `router.replace('/')`
first so the image lands on Home. No change to extraction logic.

## Data flow

1. User shares an image → iOS share sheet → taps **Add to Calendar**.
2. The Share Extension writes the image to the App Group container and opens
   the host app via the `addtocalendar` scheme.
3. The host app launches/foregrounds; `ShareIntentProvider` surfaces
   `shareIntent.files[0]`.
4. Home reads the context, sets `imageUri` to the file path, resets the intent.
5. User taps **Extract events** → existing BYOK/backend routing runs.

## Error handling / edge cases

- **Not signed-in and no key:** tapping Extract shows the existing
  "Sign in or add a key" alert — already handled, no new code.
- **Re-processing:** use `resetOnBackground: true` and call `resetShareIntent()`
  after consuming, so the same image isn't re-applied on the next foreground.
- **Multiple images:** `maxCount: 1` → take the first file only.
- **Non-image payload:** activation rules restrict to images, but guard with the
  `mimeType.startsWith('image/')` check anyway.

## Prerequisite (requires the user / Apple Developer account)

- The iOS Share Extension needs an **App Group** (`group.com.addtocalendar.rn`)
  on the Apple Developer account. Xcode automatic signing can provision it
  during the native rebuild, tied to the signing team.
- A Share Extension is best verified on a **real device**; the Simulator's
  share sheet coverage is limited.
- This is a native change: requires `expo prebuild` + a native rebuild (a new
  extension target is generated).

## Testing

- `npx tsc --noEmit` for the JS wiring (provider + Home effect).
- Build: `npx expo prebuild` then `npx expo run:ios` — confirm the Share
  Extension target is generated and the app builds.
- Manual (device): Photos → Share → **Add to Calendar** → app opens on Home
  with the image pre-filled → **Extract events** returns events. Repeat from
  Safari (long-press image → Share) to confirm cross-app behavior.
- Regression: in-app picker flow still works; signed-in vs BYOK routing
  unchanged.

## Out of scope (possible follow-ups)

- Sharing **text** or **web URLs** (URL would need fetch/scrape before
  extraction).
- Android build/verification (filters are written but no `android/` target yet).
- Auto-extract on open (chose land-and-tap).
- Multiple images per share.

## Constraints / risks

- App Group provisioning depends on the Apple Developer account.
- `expo-share-intent` + expo-router can be finicky on cold vs warm launch; the
  Home-context effect must handle both (app launched by the share vs already
  running).
- New native target increases App Store review surface (extension entitlements).
- `patch-package` postinstall must run in CI/local installs.
