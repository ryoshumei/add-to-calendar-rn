# App Store submission record — Add to Calendar

The exact values prepared and entered for the v1.0.0 App Store review submission
(2026-05-24). No secrets here (reviewer self-serves via Sign in with Apple).
Generic rules/templates live in the user skill `apple-draft`; this file is the
concrete record for **this** app.

## Status

- **Build:** v1.0.0 built via EAS (Xcode 26 / iOS 26 SDK) and uploaded to App Store
  Connect via `eas submit`. Processing in TestFlight.
- **Listing:** being filled in App Store Connect. Entered so far: Copyright,
  Content Rights, App Privacy (in progress).
- **Pending:** finish version-page fields, upload screenshots, attach build,
  App Review Information, age rating → **Add for Review → Submit**.

## App identity

| | |
|---|---|
| App Store name | **Add to Calendar: AI Events** (26 chars) |
| On-device name | Add to Calendar |
| Bundle ID | `com.addtocalendar.rn` |
| App Store Connect app ID | **6772644308** — https://appstoreconnect.apple.com/apps/6772644308 |
| Version | 1.0.0 |
| Primary category | Productivity |
| Price | Free |
| Age rating | 4+ |
| Copyright | `2026 XIUMING LIANG` (as entered; title-case optional) |
| Support URL | https://github.com/ryoshumei/add-to-calendar-rn |
| Privacy policy URL | https://github.com/ryoshumei/add-to-calendar-rn/blob/main/PRIVACY.md |
| Contact | Xiuming Liang · ryoshumei@gmail.com |

## Listing metadata

**Subtitle** (30):
```
Scan flyers, screenshots, text
```

**Keywords** (98, comma-separated, no spaces):
```
schedule,reminder,planner,OCR,invite,agenda,meeting,appointment,extract,date,ticket,organizer,todo
```

**Promotional text** (159):
```
Stop typing events by hand. Paste an invite or snap a flyer, let AI fill in the title, time, and place, then add it to your calendar in a tap. 50 free every month.
```

**Description**:
```
Add to Calendar turns the event details trapped in text and images into real calendar events, in seconds, without typing.

See a concert flyer, a class schedule, a screenshot of a group chat, or an email invite? Paste the text or snap a photo, and AI pulls out the title, date, time, and location for you. Review it, then add it straight to your iPhone calendar.

HOW IT WORKS
• Paste any text with event details, an email, a message, a poster caption
• Or pick a photo or screenshot of a flyer, ticket, or schedule
• Or share an image into the app straight from Photos or Safari
• AI extracts the title, start and end time, and location
• Tap to add to your Apple Calendar, or open it in Google Calendar

BUILT FOR SPEED
• Handles multiple events from a single text or image
• Smart date and time parsing, "next Friday at 7" just works
• Saves to your native calendar in one tap, no calendar account required

FAIR, FLEXIBLE PRICING
• Sign in with Apple or Google for 50 free extractions every month
• Or bring your own OpenAI API key for unlimited use at your own cost

PRIVATE BY DESIGN
• Your text and images are processed only to extract events and are not stored on our servers
• If you use your own API key, it stays in your device's secure Keychain and is sent only to OpenAI
• No ads, no analytics, no tracking

Delete your account and all associated data anytime from Settings.

Questions or feedback? Email ryoshumei@gmail.com
```

**What's New** (1.0.0):
```
Initial release of Add to Calendar:
• Extract events from text or photos with AI
• Add them to your Apple or Google Calendar in a tap
• Sign in with Apple or Google for 50 free extractions a month, or use your own OpenAI key
• Share images into the app from the iOS share sheet
```

## App Privacy (Data Collection)

**Do you collect data?** → **Yes.** All purpose = *App Functionality*, all
**not** used for tracking, all **linked** to identity:

| Apple category → type | Notes |
|---|---|
| Contact Info → Email Address | from Apple/Google sign-in |
| Identifiers → User ID | Supabase user UUID |
| Usage Data → Product Interaction | monthly extraction count (50/mo free tier) |
| User Content → Photos or Videos | event images sent for extraction |
| User Content → Other User Content | event text sent for extraction |

- **Not declared:** the BYOK OpenAI key — it stays in the device Keychain and is
  sent only to OpenAI, so it is not "collected."
- **Data used to track you:** None (no ads, no analytics SDKs).

## App Review Information

- **Sign-in required:** No (BYOK / guest path works without an account).
- **Demo account:** none needed — reviewer signs in with their own Apple ID.
- **Notes:**
```
This app extracts calendar events from text or images using AI. Sign-in is optional.

To test the full flow (no test account needed):
1. Settings tab → "Sign in with Apple" → authenticate with your own Apple ID.
   This creates an account with 50 free extractions/month.
2. Home screen → paste event text, e.g.:
   "Team standup tomorrow 10:00-10:30am at HQ"
   then extract. The parsed event appears; tap to add it to your calendar.
3. Image extraction: pick a photo of an event flyer/poster instead of text.
4. Adding an event uses the native iOS calendar (permission prompt on first
   use) or a Google Calendar web link — no calendar account required.

Account deletion (5.1.1(v)): Settings → "Delete account" permanently deletes
the account and all data, and revokes Sign in with Apple tokens.

Alternative: users may instead enter their own OpenAI API key in Settings and
use the app with no sign-in at all.

Contact: ryoshumei@gmail.com
```

## Compliance answers

| Question | Answer |
|---|---|
| Content Rights (third-party content?) | **No** — only the user's own input + the app's own UI |
| Export compliance / encryption | Exempt — `ITSAppUsesNonExemptEncryption: false` (standard HTTPS only) |
| Age rating questionnaire | all "None" → **4+** |
| Guideline 4.8 (Login Services) | satisfied — offers **Sign in with Apple** alongside Google |
| Guideline 5.1.1(v) (account deletion) | satisfied — in-app **Delete account** (hard delete + Apple token revocation) |

## Screenshots

Captured from the iOS Simulator (iPhone 17 Pro Max, iPad Pro 13") via `idb`+`simctl`.
Folder: `~/Desktop/appstore-shots/`. Updatable later without a new build.

| File | Size | Slot |
|---|---|---|
| `iphone-01-home.png` | 1320×2868 | iPhone 6.9" |
| `iphone-02-settings.png` | 1320×2868 | iPhone 6.9" |
| `iphone-03-result.png` | 1320×2868 | iPhone 6.9" |
| `ipad-01-home.png` | 2064×2752 | iPad 13" |
| `ipad-02-settings.png` | 2064×2752 | iPad 13" |
| `ipad-03-result.png` | 2064×2752 | iPad 13" |

Suggested display order: **result → home → settings** (lead with the payoff).

## Build / technical notes

- **EAS production profile** (`eas.json`): `autoIncrement: true`, `appVersionSource: remote`,
  and `ios.image: "latest"` — required to build with **Xcode 26 / iOS 26 SDK**
  (older images are rejected at upload with error 90725).
- **expo-share-intent + EAS:** `app.json` keeps `disableExperimental: true` on the
  plugin **and** one self-managed `appExtensions` entry — removing either breaks the
  "Read app config" build phase. (commit 52240be)
- App Store Connect API key for `eas submit` is cached on EAS (auto-generated).
- The OpenAI key used for the result screenshots was shared in plaintext during the
  session — **revoke it** on platform.openai.com if not already done.
