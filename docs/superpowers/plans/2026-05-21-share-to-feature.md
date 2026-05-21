# Share-to ("Add to Calendar" share target) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users share an image from any app into "Add to Calendar" via the iOS share sheet; the app opens on Home with the image pre-filled, ready to Extract.

**Architecture:** Add `expo-share-intent` (config plugin + native iOS Share Extension). Route the share deep link to Home via `app/+native-intent.ts`, wrap the root in `ShareIntentProvider`, and have the Home screen read `useShareIntentContext()` to pre-fill its existing image state. No new extraction logic — the shared `file://` path feeds the existing Extract flow.

**Tech Stack:** Expo SDK 52, expo-router v4, React Native 0.76, `expo-share-intent` (v3+), `patch-package`, iOS Share Extension + App Group.

**Repo:** `/Users/ryan/WebstormProjects/add-to-calendar-rn`

## Prerequisites (do before starting)

1. **Merge PR #1** (`feat/backend-image-extraction`) to `main` first, so shared images can use the backend extraction path. Without it, shared images still work but only via BYOK.
2. Create a feature branch off updated `main`: `git checkout main && git pull && git checkout -b feat/share-to`.
3. This is an **iOS-first** feature. It requires `expo prebuild` + a native rebuild and an **Apple Developer account** for the App Group (`group.com.addtocalendar.rn`). Final verification needs a **real device**.

## File Structure

- Modify: `package.json` — add `expo-share-intent`, `patch-package`, `postinstall` script
- Modify: `app.json` — add the `expo-share-intent` plugin (images only)
- Create: `app/+native-intent.ts` — route the share deep link to Home
- Modify: `app/_layout.tsx` — wrap the tree in `ShareIntentProvider`
- Modify: `app/index.tsx` — `useShareIntentContext()` effect to pre-fill the image
- Native: `expo prebuild` regenerates `ios/` with the Share Extension target (gitignored)

---

## Task 1: Install dependencies

**Files:** Modify `package.json` (+ `package-lock.json`)

- [ ] **Step 1: Install expo-share-intent (SDK-pinned)**

Run:
```bash
cd /Users/ryan/WebstormProjects/add-to-calendar-rn && npx expo install expo-share-intent
```
Expected: `package.json` gains `expo-share-intent` (v3+ for SDK 52), hoisted to top-level `node_modules`.

- [ ] **Step 2: Install patch-package**

Run:
```bash
cd /Users/ryan/WebstormProjects/add-to-calendar-rn && npm install patch-package
```
Expected: `patch-package` added to dependencies (required by expo-share-intent's install).

- [ ] **Step 3: Add the postinstall script**

In `package.json`, in the `"scripts"` block, add this line after `"prebuild": "expo prebuild"` (ensure the preceding line ends with a comma):
```json
    "postinstall": "patch-package"
```

- [ ] **Step 4: Verify package.json is valid and run postinstall once**

Run:
```bash
cd /Users/ryan/WebstormProjects/add-to-calendar-rn && node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('valid')" && npx patch-package
```
Expected: `valid`, then patch-package runs (it's a no-op if there are no patches yet — that's fine).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add expo-share-intent + patch-package for share target"
```

---

## Task 2: Configure the share-intent plugin (images only)

**Files:** Modify `app.json`

- [ ] **Step 1: Add the plugin**

In `app.json`, the `expo.plugins` array currently ends with the `expo-calendar` plugin entry. Add this entry as the next array element (after the `expo-calendar` block, before the closing `]` of `plugins`):

```json
      [
        "expo-share-intent",
        {
          "iosActivationRules": {
            "NSExtensionActivationSupportsImageWithMaxCount": 1
          },
          "iosShareExtensionName": "Add to Calendar",
          "iosAppGroupIdentifier": "group.com.addtocalendar.rn",
          "androidIntentFilters": ["image/*"]
        }
      ]
```

Make sure the preceding `expo-calendar` array element has a trailing comma so the JSON stays valid.

- [ ] **Step 2: Verify app.json is valid JSON**

Run:
```bash
cd /Users/ryan/WebstormProjects/add-to-calendar-rn && node -e "JSON.parse(require('fs').readFileSync('app.json','utf8')); console.log('valid')"
```
Expected: `valid`.

- [ ] **Step 3: Commit**

```bash
git add app.json
git commit -m "feat: register expo-share-intent plugin (images only)"
```

---

## Task 3: Route the share deep link to Home

**Files:** Create `app/+native-intent.ts`

expo-router's `+native-intent.ts` intercepts incoming deep links. The share extension opens the app with a URL containing `dataUrl=`; route that to Home (`/`) so the existing Home screen handles it.

- [ ] **Step 1: Create the file**

Create `app/+native-intent.ts`:
```ts
// Routes incoming deep links. The expo-share-intent extension opens the app
// with a URL containing `dataUrl=`; send those to Home, which reads the
// shared image via useShareIntentContext.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (path.includes('dataUrl=')) {
    return '/';
  }
  return path;
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
cd /Users/ryan/WebstormProjects/add-to-calendar-rn && npx tsc --noEmit
```
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add app/+native-intent.ts
git commit -m "feat: route share-intent deep links to Home"
```

---

## Task 4: Wrap the root layout in ShareIntentProvider

**Files:** Modify `app/_layout.tsx`

Note: deliberately do **not** pass `onResetShareIntent: () => router.replace('/')`. We consume the image on Home and call `resetShareIntent()` there; replacing the route on reset would remount Home and discard the pre-filled image.

- [ ] **Step 1: Update imports**

In `app/_layout.tsx`, change the first import line:
```ts
import { Stack } from 'expo-router';
```
to:
```ts
import { Stack } from 'expo-router';
import { ShareIntentProvider } from 'expo-share-intent';
```

- [ ] **Step 2: Wrap the returned tree**

In `app/_layout.tsx`, the component currently returns `<GestureHandlerRootView>…</GestureHandlerRootView>`. Wrap that entire element in `<ShareIntentProvider>`. The new `return` is:

```tsx
  return (
    <ShareIntentProvider options={{ resetOnBackground: true }}>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.groupedBackground }}>
        <SafeAreaProvider>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          <Stack
            screenOptions={{
              headerLargeTitle: true,
              headerTransparent: false,
              headerStyle: { backgroundColor: theme.groupedBackground },
              headerTintColor: theme.systemBlue,
              headerTitleStyle: { color: theme.label },
              headerLargeTitleStyle: { color: theme.label },
              headerShadowVisible: false,
              contentStyle: { backgroundColor: theme.groupedBackground },
            }}
          >
            <Stack.Screen name="index" options={{ title: 'Add to Calendar' }} />
            <Stack.Screen
              name="settings"
              options={{ title: 'Settings', presentation: 'modal', headerLargeTitle: false }}
            />
          </Stack>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ShareIntentProvider>
  );
```

- [ ] **Step 3: Type-check**

Run:
```bash
cd /Users/ryan/WebstormProjects/add-to-calendar-rn && npx tsc --noEmit
```
Expected: no output (success).

- [ ] **Step 4: Commit**

```bash
git add app/_layout.tsx
git commit -m "feat: wrap root in ShareIntentProvider"
```

---

## Task 5: Pre-fill the shared image on Home

**Files:** Modify `app/index.tsx`

- [ ] **Step 1: Add the import**

In `app/index.tsx`, directly below the existing line `import { Link, useFocusEffect, useRouter } from 'expo-router';`, add:
```ts
import { useShareIntentContext } from 'expo-share-intent';
```

- [ ] **Step 2: Add the share-intent effect**

In `app/index.tsx`, inside the `Home` component, find the existing focus effect:
```tsx
  useFocusEffect(
    useCallback(() => {
      refreshKey();
    }, [refreshKey]),
  );
```
Immediately AFTER it, add:
```tsx
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  useEffect(() => {
    if (!hasShareIntent) return;
    const file = shareIntent.files?.[0];
    if (file?.mimeType?.startsWith('image/')) {
      setImageUri(file.path);
    }
    resetShareIntent();
  }, [hasShareIntent, shareIntent, resetShareIntent]);
```
(`useEffect`, `useCallback`, and `setImageUri` are already imported / defined in this file.)

- [ ] **Step 3: Type-check**

Run:
```bash
cd /Users/ryan/WebstormProjects/add-to-calendar-rn && npx tsc --noEmit
```
Expected: no output (success).

- [ ] **Step 4: Commit**

```bash
git add app/index.tsx
git commit -m "feat: pre-fill Home image from shared content"
```

---

## Task 6: Prebuild + native rebuild (App Group — needs your Apple account)

**Files:** regenerates `ios/` (gitignored)

- [ ] **Step 1: Prebuild to generate the Share Extension target**

Run:
```bash
cd /Users/ryan/WebstormProjects/add-to-calendar-rn && npx expo prebuild --clean
```
Expected: `ios/` is regenerated; output shows the `expo-share-intent` plugin running and a Share Extension target being added. `pod install` runs as part of prebuild.

- [ ] **Step 2: Confirm the extension + App Group landed**

Run:
```bash
cd /Users/ryan/WebstormProjects/add-to-calendar-rn && ls ios | grep -i share; grep -ril "group.com.addtocalendar.rn" ios/*.xcodeproj ios/*/*.entitlements 2>/dev/null | head
```
Expected: a share-extension folder/target is present and the App Group identifier appears in entitlements.

- [ ] **Step 3: Set the signing team / App Group (Xcode, manual — needs your Apple Developer account)**

Open `ios/AddtoCalendar.xcworkspace` in Xcode. For **both** the app target and the new Share Extension target: Signing & Capabilities → select your Team → confirm the **App Groups** capability lists `group.com.addtocalendar.rn` (let automatic signing create it if prompted). This requires your Apple Developer account.

- [ ] **Step 4: Rebuild and launch**

Run:
```bash
cd /Users/ryan/WebstormProjects/add-to-calendar-rn && npx expo run:ios
```
Expected: app builds and launches. (For full share-sheet behavior, also build to a real device from Xcode.)

- [ ] **Step 5: Commit any tracked changes**

`ios/` is gitignored, so typically nothing new to commit here. If `app.json`/lockfiles changed, commit them:
```bash
git add -A && git commit -m "chore: prebuild for share extension" || echo "nothing to commit"
```

---

## Task 7: Manual end-to-end verification

- [ ] **Step 1: Share from Photos**

On the device/simulator: Photos → pick an event poster/screenshot → Share → choose **Add to Calendar**. Expected: the app opens on Home with that image already loaded in the IMAGE section.

- [ ] **Step 2: Extract**

Tap **Extract events**. Expected (signed-in, no key): events appear and the monthly counter increments (backend path, requires PR #1 merged). With a BYOK key set: extraction runs directly via OpenAI.

- [ ] **Step 3: Share from another app**

Repeat from Safari: long-press an image → Share → **Add to Calendar**. Expected: same — lands on Home pre-filled.

- [ ] **Step 4: Regression check**

Open the app normally, use the in-app "Choose photo" picker. Expected: unchanged behavior. Confirm the app launched without a share intent shows an empty IMAGE section (no stale shared image).

---

## Done When

- "Add to Calendar" appears in the iOS share sheet for images.
- Sharing an image opens the app on Home with the image pre-filled; **Extract events** works (backend when signed-in, BYOK otherwise).
- The in-app picker flow still works; a normal launch shows no stale shared image.
- `npx tsc --noEmit` passes; all changes committed on `feat/share-to`.

## Out of scope (per spec)

- Sharing text or web URLs; Android build/verification; auto-extract on open; multiple images per share.
