# Shipping an Expo app to the App Store: the landmines nobody warns you about

<!--
dev.to draft — paste into a new post at https://dev.to/new
Suggested front matter:
  title: Shipping an Expo app to the App Store: the landmines nobody warns you about
  tags: reactnative, expo, ios, mobile
  cover_image: (optional — the demo GIF works: https://github.com/ryoshumei/add-to-calendar-rn/raw/main/marketing/add-to-calendar-demo.gif)
  canonical_url: (leave unset unless cross-posting from an owned blog)
-->

I recently shipped [Add to Calendar: AI Events](https://apps.apple.com/app/id6772644308) — an iOS app that turns screenshots and text into calendar events — built with Expo SDK 52 and React Native's new architecture. The code is [open source (MIT)](https://github.com/ryoshumei/add-to-calendar-rn).

The happy path in the Expo docs is genuinely good. This post is about everything that *isn't* on the happy path: the things that cost me hours, in the order they'll probably cost you hours too.

## 1. An iOS Share Extension will dominate your build config

The single hardest feature to ship was also the app's core flow: share a screenshot from any app → extension hands it to the main app → AI extracts the event. I used [`expo-share-intent`](https://github.com/achorein/expo-share-intent), which is excellent, but a share extension is a *second binary target*, and EAS Build needs to be told about it explicitly.

Three things have to agree with each other or the build dies:

```jsonc
// app.json (abridged)
{
  "plugins": [
    ["expo-share-intent", {
      "disableExperimental": true,           // ← don't let the plugin manage appExtensions
      "iosActivationRules": { "NSExtensionActivationSupportsImageWithMaxCount": 1 },
      "iosAppGroupIdentifier": "group.com.addtocalendar.rn"
    }]
  ],
  "extra": {
    "eas": {
      "build": {
        "experimental": {
          "ios": {
            "appExtensions": [{               // ← you declare the target yourself, once
              "targetName": "AddtoCalendarShare",
              "bundleIdentifier": "com.addtocalendar.rn.share-extension",
              "entitlements": {
                "com.apple.security.application-groups": ["group.com.addtocalendar.rn"]
              }
            }]
          }
        }
      }
    }
  }
}
```

The landmine: if the plugin *also* injects an `appExtensions` entry (the default), EAS sees a duplicate and the build fails at the **"Read app config"** step — before compiling anything, with an error that says nothing about share extensions. `disableExperimental: true` plus exactly one hand-written `appExtensions` block was the stable combination. Once it works, commit it and never touch it.

Also budget a second provisioning profile and bundle ID (`.share-extension`) — EAS handles the signing, but App Store Connect will show the extension as its own "app" in some screens, which is normal and alarming in that order.

## 2. `patch-package` is not a code smell on mobile — it's a release valve

Two weeks after launch, users shipped me a bug: sharing a screenshot **from the iOS markup editor** (the pencil icon after you take a screenshot) crashed the share extension. The fix existed upstream in `expo-share-intent` v4 — but v4 required Expo SDK 53, and I was on 52 with a working, submitted build.

Upgrading an entire SDK to ship a five-line fix is a bad trade the week after launch. Instead:

```bash
# hand-edit node_modules/expo-share-intent/…
npx patch-package expo-share-intent
git add patches/
```

`patch-package` re-applies the diff on every `npm install` (via `postinstall`). The backported fix shipped as v1.0.2 days later, and the SDK upgrade stayed a calm, separate decision. On web I'd call vendoring a dependency a smell; on mobile, where a "dependency upgrade" can mean re-testing every native module, it's how you ship a bug fix this week instead of next month.

## 3. Your App Store listing should live in git

App Store Connect's web forms are where listing quality goes to die — you can't diff them, review them, or restore them. EAS Metadata fixes this and almost nobody uses it:

```bash
eas metadata:pull    # download the live listing into store.config.json
# edit store.config.json: description, keywords, release notes, screenshot sets
eas metadata:push    # upload — creates the new version's metadata in ASC
```

My `store.config.json` and screenshots are committed next to the code. Release notes are written in the same PR as the feature. When I pulled the live listing for the first time, I discovered the description had **corrupted line breaks** from an earlier copy-paste into the web form — it had been live like that for weeks. Listing-as-code caught what eyeballing the form never did.

Two caveats so you don't over-trust it: `metadata:push` does **not** attach a build or press "Submit for Review" — those final clicks are still manual (or fastlane/ASC API if you want to script everything).

## 4. The review prompt: where you call it matters more than that you call it

`expo-store-review` wraps `SKStoreReviewController`. Every guide says "throttle it." Fewer mention the two things that actually bit me:

**It silently does nothing on TestFlight.** By design, Apple suppresses the dialog there. If you're smoke-testing "does my rating prompt fire?", you must test a release build on a simulator/device *outside* TestFlight, or you'll ship believing it's broken (or worse, that it's not, when it is).

**It will collide with your own dialogs.** My prompt fires after a successful "event added" alert. Fire both and iOS will drop one on the floor. The fix is sequencing, not timing hacks — ask only after the user dismisses your alert:

```tsx
Alert.alert('Added', `"${event.title}" added to your calendar.`, [
  { text: 'OK', onPress: () => void recordSuccessfulAddAndMaybeAskForReview() },
]);
```

The throttle itself: require ≥2 successful adds (proven value), ask at most once per app version, persist both in AsyncStorage, and never let the review path throw into your core flow. Apple additionally caps the system prompt at ~3 shows per year — treat `requestReview()` as a suggestion, not a call you own.

## 5. Multiline `TextInput` + a submit button = a keyboard you can't dismiss

A classic that every RN form eventually hits: a multiline input has no "done" affordance, the keyboard covers your primary button, and iOS users — who expect tap-outside-to-dismiss from native apps — get stuck. Three props, all needed:

```tsx
<TextInput
  multiline
  returnKeyType="done"        // Return key says Done…
  submitBehavior="blurAndSubmit"  // …and dismisses instead of inserting \n
/>
// on the enclosing ScrollView:
keyboardDismissMode="on-drag"     // scrolling tucks the keyboard away
keyboardShouldPersistTaps="handled"
```

The trade-off is honest: Return no longer inserts newlines. For a paste-mostly input that's right; pasted text keeps its line breaks anyway.

## 6. Dark mode will look wrong in exactly one place: your modal sheets

If you build semantic colors (`label`, `separator`, grouped backgrounds) into a theme hook from day one, dark mode is nearly free — except for modals. iOS grouped backgrounds are **pure black** in dark mode, and a modal sheet rendered in pure black on a pure-black screen has no visible edge. Native apps solve this with *elevated* variants; do the same:

```tsx
// in the modal screen only
const theme = {
  ...baseTheme,
  groupedBackground: baseTheme.elevatedGroupedBackground,
  card: baseTheme.elevatedCard,
};
```

One remap at the top of the modal, and the sheet reads as a sheet again.

## 7. Privacy architecture is an App Store feature, not a legal chore

The app has a bring-your-own-OpenAI-key mode. Two implementation decisions made App Review painless and became the listing's selling point:

- The key lives in the iOS Keychain via `expo-secure-store`, is sent **only** to `api.openai.com`, and never touches my server. That sentence goes verbatim into the privacy labels, the reviewer notes, and the description — and it's true, which is what makes Guideline 2.3 (accurate metadata) easy.
- Account deletion is in-app (Apple requires it if you have accounts at all — budget for it *before* your first submission, it's a server-side feature, not a button).

One more pre-flight item that surprises people: `ITSAppUsesNonExemptEncryption: false` in `Info.plist` saves you an export-compliance question on every single upload.

## The boring meta-lesson

Every one of these was discoverable only by shipping. The gap between "runs in Expo Go" and "approved on the App Store" is real but bounded — roughly: one build-config fight (share extension), one process discovery (metadata as code), and a handful of platform behaviors (review prompt, keyboard, dark mode) that each cost an afternoon.

If you're one `eas submit` away and hesitating: the reviewer is not your enemy, the checklist is finite, and the second submission takes a tenth the time of the first.

---

*The app: [Add to Calendar: AI Events](https://apps.apple.com/app/id6772644308) — screenshots/text → calendar events. Source: [github.com/ryoshumei/add-to-calendar-rn](https://github.com/ryoshumei/add-to-calendar-rn). Questions about any of these landmines welcome in the comments.*
