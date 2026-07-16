# Launch Kit — Add to Calendar: AI Events

App Store: https://apps.apple.com/app/id6772644308
Assets: `marketing/add-to-calendar-demo.mp4` (prefer where video allowed) · `add-to-calendar-demo.gif`

---

## 0. Pre-flight (do before any launch post)

- [ ] **Confirm v1.0.1 is live** in App Store Connect (submitted 2026-05-30). Launch traffic must land on the polished-ASO listing.
- [ ] Open the App Store page in an incognito/logged-out browser — screenshots, subtitle, promo text all look right.
- [ ] Support URL + privacy policy links resolve.
- [ ] Chrome extension v1.2.2 cross-promo is live in the Web Store (drives desktop users to the same page during the spike).
- [ ] You can respond to comments for most of launch day (PH ranking is engagement-driven).

---

## 1. Product Hunt

**Launch timing:** Tuesday–Thursday, **12:01 AM Pacific**. Self-hunting is normal now — no need to find a "hunter."

**Name:** `Add to Calendar: AI Events`

**Tagline** (≤60 chars — pick one):
1. `Turn screenshots and text into calendar events with AI` *(recommended, 55)*
2. `Screenshot → calendar event, in seconds` (40)
3. `Stop retyping event details into your calendar` (47)

**Description** (≤260 chars):
> Paste text or snap a screenshot of a flyer, email, or ticket — AI extracts the title, date, time, and location and saves it to your calendar in one tap. Free 50/month with sign-in, or bring your own OpenAI key. No ads, no tracking.

**Topics:** Productivity · Calendar · iOS · Artificial Intelligence

**Gallery order:** 1) demo **MP4** (video slots outperform stills) · 2) result-card screenshot · 3) share-extension screenshot · 4) settings/privacy screenshot. Spec if you remake stills: 1270×760 landscape performs best.

**First maker comment** (post immediately after launching):

> Hey Product Hunt 👋
>
> Event details never arrive in a calendar-friendly format — they arrive as a screenshot of a concert poster, a flyer on a wall, three lines buried in an email. I got tired of retyping them, so I built this.
>
> **How it works:** paste text or share/snap any image → AI pulls out the title, date, time, and location → one tap saves it to Apple Calendar (or opens Google Calendar). There's a share extension, so it works straight from your screenshots.
>
> **The part I care most about:** privacy. Sign in with Apple or Google for a free tier (50 extractions/month) — or skip accounts entirely and bring your own OpenAI key. The key is stored only in the iOS Keychain and never touches my servers. No ads, no tracking, in-app account deletion.
>
> It started as a Chrome extension; the iPhone version exists because that's where the screenshots are. 🙂
>
> I'd love feedback — especially on what input formats trip it up. I'll be here all day answering questions.

**Launch-day rules of thumb:** reply to every comment; share the PH link in your communities but *never* say "upvote me" (PH penalizes it); add the PH badge to the README/extension page after launch.

---

## 2. Reddit

**Golden rule:** each sub gets a *different, native-feeling* post — never the same text twice, never a bare link-drop. Attach the **GIF** directly in posts where media is allowed. Stagger: 2 subs on launch day, the rest over the following week.

### r/SideProject (self-promo friendly — post the story)
**Title:** `I kept screenshotting event flyers and retyping them into my calendar, so I built an app that does it automatically`
**Body:**
> Every concert, appointment, or meetup I hear about arrives as a screenshot or a random line of text — and I'd end up retyping it all into my calendar. So I built **Add to Calendar**: paste text or share a screenshot, AI extracts the event (title/date/time/location), one tap saves it.
>
> Stack, since it's r/SideProject: Expo / React Native (new arch), Supabase Edge Functions for the shared backend, share extension for the screenshot flow. Started life as a Chrome extension — the iOS app shares the same backend.
>
> Business model experiment: free tier (50/month, sign in with Apple/Google) or bring-your-own OpenAI key stored in the Keychain — BYOK calls go straight from your phone to OpenAI, never through my server.
>
> [GIF attached]
>
> App Store: https://apps.apple.com/app/id6772644308
> Would love feedback — especially inputs it fails on.

### r/iosapps (showcase format — direct is fine)
**Title:** `[Free] Add to Calendar: AI Events — turn screenshots, flyers & text into calendar events`
**Body:**
> - Share any screenshot to the app (or paste text) → AI extracts title, date, time, location
> - One tap → saved to Apple Calendar, or open in Google Calendar
> - Sign in with Apple/Google: 50 free extractions/month
> - Or bring your own OpenAI key (stored in Keychain only) — no account needed
> - No ads, no tracking, account deletion in-app
>
> [GIF attached]
> https://apps.apple.com/app/id6772644308

### r/OpenAI (the BYOK angle — genuinely on-topic)
**Title:** `I built an iOS app around a bring-your-own-OpenAI-key model — screenshots → calendar events`
**Body:**
> Wanted to share the architecture more than the app: users can paste their own OpenAI API key, it's stored in the iOS Keychain, and extraction calls go **directly from the device to api.openai.com** — my server never sees the key or the images. (There's also a free hosted tier for people who don't have a key.)
>
> The app itself turns screenshots/flyers/text into calendar events. Happy to answer questions about BYOK UX — key validation, error handling, what users actually think of it.

### r/productivity (⚠️ strict no-self-promo)
Don't link-drop — it will be removed. Two safe plays:
1. Post in the **weekly promo/stickied thread** with 2–3 lines + link.
2. Or a genuine text post about the *workflow* ("how I stopped retyping event details") and only name the app if asked in comments.

### Bonus: Hacker News — Show HN
**Title:** `Show HN: Add to Calendar – iOS app that turns screenshots into calendar events`
**First comment:** condensed r/SideProject story + stack + BYOK privacy design. HN cares about: the Keychain/BYOK architecture, no tracking, honest free-tier limits. Expect blunt feedback; answer technically.

---

## 3. Comment crib sheet (both platforms)

- **"Why sign in at all?"** — The free tier's LLM calls run on my backend, so it needs an identity for the 50/month quota. Skip it entirely with your own OpenAI key.
- **"Privacy? Where do my screenshots go?"** — Free tier: image/text → my Supabase Edge Function → OpenAI, nothing retained beyond the request + a usage counter. BYOK: device → OpenAI directly. Key lives in the iOS Keychain. Account + data deletable in-app.
- **"Android?"** — Codebase is Expo/React Native, Android build is planned; iOS first because that's where the share-sheet workflow shines.
- **"vs Fantastical's natural-language input?"** — Fantastical parses text you *type into it*. This ingests what you already *have* — screenshots, flyers, forwarded emails — via the share sheet, no retyping.
- **"Why is image extraction BYOK-only?"** — Vision calls are ~10× the cost of text; the free tier stays sustainable by keeping images on your own key. If usage grows I'll revisit.
- **"Is it open source?"** — The Chrome extension sibling shares the backend; app source isn't public today. (Adjust if you change this.)

---

## 4. Apple featuring nomination (paste-ready)

**Where:** https://developer.apple.com/contact/app-store/promote/ (sign in with the developer account → "Nominate your app for featuring"). Free — this is editorial, not ads. Submit 3–4+ weeks before any moment you want featured.

- **App:** Add to Calendar: AI Events — `com.addtocalendar.rn` (ASC ID 6772644308)
- **What's new / timing:** New app, launched May 2026; v1.0.1 live (in-app ratings + refined listing).
- **What makes it great:**
  > Add to Calendar turns the messy ways event details actually reach us — a screenshot of a concert poster, a forwarded email, a class syllabus, a line of text — into a ready-to-save calendar event in seconds. AI extracts the title, date, time, and location; one tap saves it to Apple Calendar. It's a focused, single-purpose utility that respects the platform and the user: share a screenshot from any app via the Share Extension, sign in with Apple, and save natively with EventKit. Privacy-first by design — no ads, no third-party tracking, an optional bring-your-own-key stored only in the iOS Keychain (it never leaves the device except to reach the model), and in-app account deletion. Built by an independent developer.
- **Apple technologies:** Share Extension · Sign in with Apple · EventKit · Keychain · built with the latest SDK (Xcode 26 / iOS 26).
- **Languages/regions:** English; worldwide.

---

## 5. After the spike

- Reply to *every* App Store review that arrives during launch week.
- Watch ASC Analytics → Sources to see which channel converted; double down there.
- Post-launch follow-ups: PH badge in README/extension listing, an English technical article (dev.to / own blog) on the BYOK/share-extension architecture, and the Apple featuring nomination if not yet sent.
