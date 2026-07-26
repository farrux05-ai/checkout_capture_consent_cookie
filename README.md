# Shopify Checkout Custom Pixel — Consent-Aware, Server-Side Enriched Tracking

A Shopify Custom Pixel for the checkout flow that:
- Respects Google Consent Mode v2, sourced from Shopify's native Customer Privacy API (not a third-party CMP — those don't run on checkout at all).
- Captures real marketing click-IDs (`fbc`, `gclid`, `ttp`) via Shopify's sanctioned async cookie API, since raw `document.cookie` is blocked in the sandbox.
- Pushes one enriched `dataLayer` event per checkout step, consumed by a first-party GTM container that forwards to GA4, Google Ads, Meta CAPI, TikTok Events API, and Klaviyo via Stape server-side tags.

This is a **living document** — sections are marked `[DONE]` or `[PENDING]` as the implementation progresses. Update the status table on every commit.

## Status

| Piece | Status | Notes |
|---|---|---|
| 1. Consent Mode (default + live updates) | ✅ DONE | `initConsentMode()` |
| 2. Marketing cookie capture (`fbc`, `fbp`, `gclid`, `ttp`) | ✅ DONE | `getMarketingCookies()` |
| 3. GTM container injection (first-party subdomain) | ✅ DONE | `loadGTM()` — pre-existing, de-minified |
| 4. Checkout event capture → `dataLayer` | ✅ DONE | `handleAnalyticsEvent()` / `prepareDataLayerObject()` |
| 5. `event_id` for dedup (purchase = order-based, stable) | ✅ DONE | `generateEventId()` |
| 6. Stape Store integration (new vs. returning customer) | ⬜ PENDING | Not yet started — server container config, not pixel code |
| 7. GTM-side consent gating on Meta/TikTok tags | ⬜ PENDING | Manual GTM config — see [Required GTM-side setup](#required-gtm-side-setup) |
| 8. Load-time / speed verification | ⬜ PENDING | Needs a real Network-tab measurement on live checkout |

## Why this exists — the sandbox reality

Shopify checkout runs custom pixels inside a **sandboxed iframe**. This has concrete, verified consequences (see [Shopify's own docs](https://shopify.dev/docs/api/web-pixels-api) and [Stape's official statement](https://stape.io/news/webinar-server-side-tracking-done-right)):

- `document.cookie` returns `undefined` in the sandbox. Reading real cookies requires the async `browser.cookie.get(name)` API instead — this reaches the actual top-frame cookie jar via a Shopify-controlled proxy.
- You **cannot set cookies** from inside the sandbox. Stape's own team confirms this directly: *"you won't be able to set a cookie in the sandbox... our advice is to use Stape's Shopify app [for storefront], not a custom pixel [for checkout]."* This is why returning-visitor identity persistence for checkout should go through **Stape Store** (a server-side key-value store), not `localStorage`/cookie writes from this script.
- `window.location.href` returns the sandbox's own URL, not the real checkout URL. Use `init.context.document.location.href` instead (already wired into this script as `href`).
- A GTM container injected here (via `loadGTM()`) **does execute**, but anything it does that depends on cookies or the real page (Meta Automatic Advanced Matching, `document.cookie` reads inside a Meta/TikTok pixel tag) operates on the sandbox's own isolated context, not the real page. That's why we don't rely on client-side pixel tags for checkout — we capture what's needed ourselves (via the sanctioned APIs) and forward it server-side through Stape's Data Tags → CAPI/Events API.

Net result: the GTM container stays (it's the transport to the server container), but the *source of truth* for cookies/URL/consent is our own pixel code using Shopify's sanctioned APIs — not whatever a client pixel tag would try to read on its own inside the container.

## Architecture

```
Shopify checkout event (analytics.subscribe)
        │
        ├─ initConsentMode() — runs once, before loadGTM()
        │     ├─ gtag('consent','default', ...)   ← from init.customerPrivacy
        │     └─ customerPrivacy.subscribe(...)    ← live updates while on checkout
        │
        ├─ loadGTM() — injects GTM container from our own first-party subdomain
        │
        └─ handleAnalyticsEvent(event)  [async]
              │
              ├─ getMarketingCookies()  [async, parallel reads via browser.cookie.get]
              │     → fbc, fbp, gclid (parsed from _gcl_aw), ttp
              │
              ├─ prepareDataLayerObject(event, eventName)
              │     → event, event_id, user_data, ecommerce, cart_state,
              │       actual_url (from init.context, not window.location),
              │       fbc, fbp, gclid, ttp
              │
              └─ window.dataLayer.push(obj)
                     │
                     ▼
              GTM container (already has Consent Mode defaults loaded)
                     │
                     ├─► [Stape] GA4 tags          → GA4 / Google Ads
                     ├─► [Stape] DT (Data Tag)      → Stape Client (server container)
                     │                                   ├─► Meta Conversions API
                     │                                   ├─► TikTok Events API
                     │                                   └─► Klaviyo
                     └─► (client Meta/TikTok pixel tags — NOT relied upon for
                           checkout; see sandbox reality above)
```

## Implementation — how to deploy this

1. **Shopify Admin → Settings → Customer events.** Open the existing custom pixel (or create one if starting fresh) and replace its entire contents with `custom-pixel.js` from this repo.
2. **Set the pixel's permission requirement to "Not required."** This is required for Consent Mode to work correctly — if the pixel is gated behind "Analytics"/"Marketing" consent, Shopify won't run the code at all when consent is denied, which means no `gtag('consent','default',...)` call ever fires and Google can't model the denied traffic. Consent enforcement should happen *inside* the code (Consent Mode) and *inside* GTM (per-tag consent settings), not at the pixel-gate level.
3. **Shopify Admin → Settings → Customer Privacy.** Confirm the regions/requirements here match whatever your storefront CMP (e.g. Cookiebot) enforces. This setting — not Cookiebot — is what `customerPrivacy`/`init.customerPrivacy` reports on checkout, since third-party CMP scripts don't run on checkout at all.
4. **GTM container** (the one loaded from your custom subdomain): no changes needed for Pieces 1–5 above — the container itself is unchanged, only what we push into `dataLayer` changed.
5. Save and activate the pixel. Test using the checklist below before assuming anything is live-safe.

## Required GTM-side setup

Code changes alone aren't sufficient for genuine consent compliance — GTM itself must also enforce it:

- For each `[Stape] Meta - *` and `[Stape] TikTok - *` tag, and the corresponding `[Stape] DT - *` Data Tags: open **Tag Configuration → Advanced Settings → Consent Settings → Require additional consent for tag to fire**, and add `ad_storage`. Google's own tags (GA4, Ads) respect Consent Mode natively; third-party templates are not guaranteed to, so this per-tag setting is the belt-and-suspenders enforcement.
- Add a **Data Layer Variable** for each new field this script now pushes (`fbc`, `fbp`, `gclid`, `ttp`, `event_id`) so downstream tags can reference them.
- Map `fbc`/`gclid` into the corresponding Meta CAPI / Google Ads Conversion tag fields in the **server** container. Per [Simo Ahava's writeup on this exact Shopify+sGTM scenario](https://www.simoahava.com/analytics/cookie-access-with-shopify-checkout-sgtm/), Google Ads Conversion tags in server-side GTM need a Transformation to accept `gclid` as a custom event parameter (since server GTM has no cookie access of its own) — the client-side capture in this script is only half the pipeline.

## Testing checklist (do this before every deploy)

Open the checkout page with DevTools Console open (the script logs verbosely when `isLog = true`, which is intentional for now — turn it off only once everything below is verified stable):

- [ ] `CONSENT: boshlang'ich privacy snapshot` shows a real object (not `undefined`)
- [ ] `CONSENT: default yuborildi ->` shows `granted`/`denied` values matching your actual consent state
- [ ] If your store shows a consent banner on checkout too: changing consent triggers `CONSENT: update yuborildi ->`
- [ ] `COOKIE: o'qilgan qiymatlar ->` appears for every checkout event
- [ ] Test with a URL containing `?gclid=test123` (or a real Meta ad click) all the way through to checkout — confirm `gclid`/`fbc` show non-null values in `Send event data`
- [ ] Network tab: confirm the GTM container script (`.../3sibtwmwlxmfa.js`) actually loads, and note how long after page load it fires (this is Piece 8, not yet formally measured)
- [ ] Reload the thank-you page and confirm `purchase` isn't double-counted in Meta/TikTok Events Manager (event_id should be identical across the reload)
- [ ] Meta Events Manager / TikTok Events Manager → confirm events show up server-side with reasonable Event Match Quality

## Known limitations / open items

- Piece 6 (Stape Store for new-vs-returning classification) is **not implemented yet**. This is primarily a server-container configuration task (Cookie reStore / Enricher power-up tags), not pixel code — will be documented here once built.
- Piece 8 (load-time verification) is a measurement task, not a code task — do this on a live store, not in review.
- `isLog = true` produces a lot of console output. Fine for the current testing phase; set to `false` before considering this production-final.
