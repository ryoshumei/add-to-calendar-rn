# Marketing Playbook

The durable strategy for all products (apps, extensions, tools) — not just this one.
Written 2026-07, after the Add to Calendar launch. Update it when reality disagrees.

## Core thesis

Marketing time goes to channels that are **owned** or that **compound**. Channels where
you rent an audience under someone else's rules are luxuries, used episodically or not
at all. The engine is: **ship fast → be findable in store search → let your products
promote each other → publish compounding content.**

---

## Tier 1 — The machine (always on, every product)

**1. Store search (ASO).**
For utility products this is where users actually come from — people *searching for the
problem*, not browsing feeds. Per product: name/subtitle carry the heaviest keywords,
keyword field has zero duplicates, screenshots show the payoff in shot #1, description
survives a truthfulness audit (Guideline 2.3). Revisit quarterly; treat the listing as
code (EAS Metadata / `store.config.json`).
Global focus makes **store localization** the cheapest big lever: localized keywords +
description + screenshots in major storefronts (ES, PT-BR, DE, FR, JA, ZH…) unlock
search traffic English listings never see. AI makes this nearly free — do it once the
English listing is proven.

**2. The ratings flywheel.**
In-app review prompt at the moment of delivered value (never at launch, never before
value; throttled per version). Ratings → rank → installs → ratings. Reply to every
store review in the first months.

**3. Cross-promotion across the portfolio.**
Every product is a channel for the others (extension popup ↔ iOS app, future apps
likewise). Placement rule: promote at the *success moment*, styled natively, one tap to
the store. This moat scales with shipping speed — nobody else can put a banner in your
products.

## Tier 2 — Compounding content (the best use of "marketing time")

**4. English technical writing (global-first).**
Publish where distribution is built in and ungated: **dev.to** (no karma system, dev
audience, strong Google ranking) and/or an owned blog (GitHub Pages — owned asset,
compounds forever). Write what was actually hard: share extensions, EAS gotchas, BYOK
architecture, App Store review. Every article permanently links the products. One good
post outperforms a month of forum posting. (Japanese/Zenn is optional bonus reach, not
the strategy — the market focus is global.)

**5. Open source / GitHub.**
Public MIT repos are discoverable forever; a good README ranks in Google and doubles as
a landing page. Open-sourcing also unlocks the PH open-source flag and HN credibility.

## Tier 3 — Launch events (episodic; run the playbook, then leave)

**6. Product Hunt** — once per product/major version. Playbook exists (`launch-kit.md`):
schedule Tue–Thu 12:01 AM PT, video first in gallery, pre-written maker comment,
reply to everything, harvest feature requests into issues. Success = permanent page +
feedback + backlink, not top-5.

**7. Show HN** — when shipping anything developer-facing. No karma gate on Show HN;
lead with architecture (privacy/BYOK angles play well). Expect blunt feedback; answer
technically.

**8. Apple featuring nominations** — free lottery tickets. Submit for every launch and
major update (3–4 weeks lead). Using new Apple tech (widgets, App Intents, new SDK
features) materially raises the odds — factor that into roadmaps.

## Deliberately NOT pillars

**Reddit.** Verdict from 2026-07: filtered post, silent mods, karma-gated. Keep the
account, comment only when genuinely moved to (no schedule, no quota, no karma
projects), and revisit *if* equity accumulates naturally. Organic mentions by others are
the free win (Reddit ranks in Google) — earn them with the product, don't manufacture
them. Never a launch dependency again.

**Paid ads.** Wrong stage — unit economics of free apps don't support it, and it teaches
nothing about organic pull.

**Social feeds (X/Instagram/TikTok).** Only if it becomes personally enjoyable
(build-in-public). As an obligation it's a treadmill, not an asset.

## The loop, per new product

1. Ship with the flywheel built in (review prompt, cross-promo hooks, clean ASO) —
   it's ~one day of work now.
2. Launch: PH (+ Show HN if dev-facing) + featuring nomination + cross-promo banners
   flipped on in the existing portfolio.
3. Within a month: one English technical article (dev.to / own blog) about the hardest
   problem it involved.
4. Then: respond to reviews, harvest feature requests into "you asked, we shipped"
   releases, and get back to shipping.

## Metrics that matter

- App Store: impressions → product page views → installs (ASC → Analytics → Sources),
  rating count/average.
- Which channel converted (Sources tags PH/GitHub/etc.).
- Everything else (upvotes, karma, followers) is vanity unless it moves the above.
