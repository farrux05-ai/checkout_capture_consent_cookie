/**
 * ============================================================================
 * CUSTOM PIXEL — Checkout Events → Stape GTM (first-party subdomain)
 * ============================================================================
 *
 * WHAT CHANGED AND WHY:
 *
 * 1) The fetch() call to Stape App's shared CDN (sp.stapecdn.com) was
 *    removed entirely. That domain is shared across every Stape customer,
 *    so it frequently ends up on adblock lists (EasyList/EasyPrivacy) — if
 *    blocked, the subscribe() call inside the .then() never runs and
 *    nothing gets tracked. Instead, only loadGTM() remains, which loads
 *    the GTM container from your own first-party subdomain
 *    (data.farruxbek.online). This is far more resistant to blockers,
 *    since it isn't a shared, publicly known tracking domain.
 *
 * 2) event_id is now generated in exactly one place and written to the
 *    dataLayer object once (generateEventId()). A single dataLayer.push()
 *    means both the client-side pixel tag (Facebook/TikTok Pixel by
 *    Stape) and the server Data Tag read the identical event_id from the
 *    same dataLayer entry — so both sides always match. Previously, when
 *    Stape auto-generated the ID itself in a hybrid setup, the two sides
 *    generated two different IDs, breaking deduplication. That's fixed now.
 *
 * 3) For checkout_completed (purchase), event_id is built from the STABLE
 *    order ID (not random). Reason: if the thank-you page reloads (F5,
 *    back/forward), checkout_completed can fire again. With a random ID,
 *    Meta/TikTok/GA4 would count that as a second purchase, inflating
 *    ROAS/sales numbers. Since the order ID never changes, the replayed
 *    event carries the same event_id and ad platforms deduplicate it
 *    automatically — one order = one conversion, no matter how many times
 *    the page reloads.
 *
 * 4) For every other event (add_payment_info, begin_checkout, etc.), we
 *    use event.id, which Shopify guarantees is unique per dispatch (per
 *    the Web Pixels API). There's no need to mint our own
 *    crypto.randomUUID() — what matters is that this value is read once,
 *    here, and written into a single dataLayer object, not generated
 *    twice.
 *
 * ----------------------------------------------------------------------------
 * REQUIRED GTM-SIDE SETUP (for this code to work):
 *
 *   a) In GTM, create a new Data Layer Variable, e.g. named
 *      "DLV - event_id", with Data Layer Variable Name: event_id
 *
 *   b) In each of the following TAGS, bind the "Event ID" (or "event_id")
 *      field to {{DLV - event_id}}:
 *         - [Stape] Meta - AddPaymentInfo / AddToCart / InitiateCheckout /
 *           PageView / Purchase / Search / ViewContent
 *         - [Stape] TikTok - (same list)
 *         - [Stape] DT - * (Data Tags — these carry event_id through Stape
 *           Client to the server container, where the Meta CAPI / TikTok
 *           Events API tags must also read this same event_id)
 *
 *   c) If any of these tags has an "Auto-generate Event ID" toggle (or
 *      similar), turn it OFF. Otherwise Stape may generate an additional
 *      ID of its own, either overwriting or duplicating alongside the
 *      exact event_id we already set.
 *
 *   d) In Shopify Admin → Settings → Customer events, check whether Stape
 *      App's own auto-installed Web Pixel (the one with the
 *      fetch(sp.stapecdn.com...) code) is still active. If so, disable or
 *      remove it — otherwise two pixels run simultaneously, the GTM
 *      container loads twice, and every event fires twice (duplicated).
 * ============================================================================
 */

// The Shopify Custom Pixel editor provides `analytics`, `browser`, and
// `init` objects ready to use (no register() wrapper needed) — so we use
// them directly rather than through window. This also helps Shopify's own
// static checker recognize the "analytics.subscribe(...)" call more
// reliably (this is how the official examples write it too).
const initContext = init;

const GTM_ID = '5TCF99SP'; // From the settings tag
const GTM_URL = 'https://data.farruxbek.online'; // First-party (custom) subdomain

const sandbox_events = [
  'payment_info_submitted',
  'checkout_started',
  'checkout_shipping_info_submitted',
  'checkout_contact_info_submitted',
  'checkout_completed',
  'alert_displayed',
  'ui_extension_errored'
];

const event_name = {
  "page_viewed": "page_view_stape",
  "payment_info_submitted": "add_payment_info_stape",
  "checkout_started": "begin_checkout_stape",
  "checkout_shipping_info_submitted": "add_shipping_info_stape",
  "checkout_contact_info_submitted": "add_contact_info_stape",
  "checkout_completed": "purchase_stape",
  "alert_displayed": "alert_displayed_stape",
  "ui_extension_errored": "ui_extension_errored_stape"
};

const isLog = true;
const useMultyMarkets = false;
let isInsertGTM = false;

const href = initContext?.context?.document?.location?.href || "";
const isCheckoutPage = href.includes("/checkouts");
const canSubscribe = analytics && typeof analytics.subscribe === "function";

let customerShopStape = {};
try {
  customerShopStape = JSON.parse(window.localStorage.getItem('customerShopStape')) || {};
} catch (e) {}

const clearObj = (obj = {}) =>
  Object.fromEntries(
    Object.entries(obj).filter(([_, value]) => value !== null && value !== undefined && value !== '')
  );

// "gid://shopify/Order/1234567890" -> "1234567890"
function extractNumericId(gid) {
  return gid ? String(gid).split('/').pop() : null;
}

// =======================================================================
// PART 1 — CONSENT MODE
// =======================================================================
// Shopify Customer Privacy -> Google Consent Mode.
//
// Third-party CMPs (e.g. Cookiebot) do NOT run on checkout at all —
// Shopify doesn't allow third-party scripts there. So the only consent
// source here is Shopify's own native Customer Privacy API:
//   - initContext.customerPrivacy      -> initial (default) state
//   - customerPrivacy.subscribe(...)   -> subsequent changes
// This depends on Shopify Admin -> Settings -> Customer Privacy, NOT on
// your CMP's own settings — verify the two are aligned separately.
//
// VERIFYING (after adding this piece, open the console on checkout):
//   1. Look for the "CONSENT: initial privacy snapshot" log — confirms a
//      real customerPrivacy object is arriving (if undefined, the problem
//      is right here — don't move to the next step yet).
//   2. Look for the "CONSENT: default pushed" log — shows exactly which
//      values (granted/denied) were sent.
//   3. If checkout shows a consent banner and you interact with it —
//      "CONSENT: update pushed" should fire.

window.dataLayer = window.dataLayer || [];

// gtag() shim — writes a "consent" command into dataLayer in the exact
// format GTM's own internal Consent Mode protocol expects. It lands in
// the same array as window.dataLayer.push(obj), but GTM recognizes this
// specific (arguments-style) shape and runs its native consent machinery
// on it.
function gtag() {
  if (isLog) console.log('CONSENT: gtag() called', arguments);
  window.dataLayer.push(arguments);
}

function mapConsentToGtag(privacy) {
  const marketing = !!privacy?.marketingAllowed;
  const analyticsOk = !!privacy?.analyticsProcessingAllowed;
  const preferences = !!privacy?.preferencesProcessingAllowed;
  return {
    ad_storage: marketing ? 'granted' : 'denied',
    ad_user_data: marketing ? 'granted' : 'denied',
    ad_personalization: marketing ? 'granted' : 'denied',
    analytics_storage: analyticsOk ? 'granted' : 'denied',
    personalization_storage: preferences ? 'granted' : 'denied',
    // These are normally always "granted" — required for the site's
    // basic technical operation and security, not gated by consent.
    functionality_storage: 'granted',
    security_storage: 'granted'
  };
}

// Kept here so we can apply an explicit, server-side-checkable filter
// instead of relying on GTM's "invisible" internal consent state — the
// last known consent state is tracked and attached to every event
// payload as an explicit field (see prepareDataLayerObject below).
let currentConsentState = null;

function initConsentMode() {
  const initialPrivacy = initContext?.customerPrivacy;
  if (isLog) console.log('CONSENT: initial privacy snapshot', initialPrivacy);

  // 1) Set the default state BEFORE the GTM container loads. This is
  //    required — otherwise tags that fire the instant GTM initializes
  //    (e.g. the GA4 config tag) could fire without any consent state.
  const defaultConsent = mapConsentToGtag(initialPrivacy);
  currentConsentState = defaultConsent;
  gtag('consent', 'default', Object.assign({}, defaultConsent, { wait_for_update: 500 }));
  if (isLog) console.log('CONSENT: default pushed ->', defaultConsent);

  // 2) If consent changes later (checkout may show a banner in some
  //    regions too) — forward the update to GTM AND keep it stored, so
  //    subsequent events pick up the updated state.
  if (typeof customerPrivacy === 'undefined' || !customerPrivacy?.subscribe) {
    if (isLog) console.warn('CONSENT: customerPrivacy.subscribe not found — staying on default only');
    return;
  }

  customerPrivacy.subscribe('visitorConsentCollected', (event) => {
    const updatedConsent = mapConsentToGtag(event?.customerPrivacy);
    currentConsentState = updatedConsent;
    gtag('consent', 'update', updatedConsent);
    if (isLog) console.log('CONSENT: update pushed ->', updatedConsent, 'raw:', event?.customerPrivacy);
  });
}

function extractMarketData(event) {
  const marketData =
    event.data?.checkout?.localization?.market ??
    event.data?.localization?.market ?? null;

  return {
    id: extractNumericId(marketData?.id),
    handle: marketData?.handle ?? null,
  };
}

/**
 * event_id generator — single source of truth. This function's result is
 * written directly into the dataLayer object, and every tag in GTM
 * (client pixel and server Data Tag alike) reads that same value.
 */
function generateEventId(event, eventName) {
  if (eventName === 'checkout_completed') {
    // Purchase — a STABLE id derived from order.id. Even if the page
    // reloads, the same id comes back -> ad platforms deduplicate it and
    // never double-count the sale.
    const orderId = extractNumericId(event?.data?.checkout?.order?.id);
    if (orderId) return 'purchase_' + orderId;
    // Rare fallback if order.id hasn't arrived yet:
    return 'purchase_' + (event?.data?.checkout?.token || event.id);
  }

  // Every other event — use the event.id Shopify guarantees is unique
  // per dispatch.
  return eventName + '_' + event.id;
}

// =======================================================================
// PART 2 — READING MARKETING COOKIES (fbc, fbp, gclid, gbraid, ttp)
// =======================================================================
// document.cookie does NOT work in the checkout sandbox — it returns
// undefined (this is confirmed in Shopify's own official documentation).
// Instead, Shopify provides an ASYNC, sanctioned API:
// browser.cookie.get(name) -> Promise<string>. This reaches the REAL
// top-frame cookie jar (through a proxy) — so the value read here is
// REAL, not the sandbox's own isolated cookie.
//
// _gcl_aw format: "GCL.<timestamp>.<value>" — to get the value, we split
// on the dot (.) and take EVERYTHING after the SECOND dot.
//
// VERIFYING: on checkout, look for the "COOKIE: values read ->" log in
// the console. If fbc/fbp/gclid all come back `null`, that can be a
// perfectly normal outcome (if the customer didn't arrive via an ad,
// those cookies simply never exist) — not a bug. Only worth worrying
// about if you deliberately tested via an ad link and it's still null.

async function safeGetCookie(name) {
  try {
    const value = await browser.cookie.get(name);
    return value || null;
  } catch (err) {
    if (isLog) console.warn('COOKIE: "' + name + '" could not be read ->', err);
    return null;
  }
}

// Extracts the value from a "GCL.<timestamp>.<value>" format. We take
// everything after the SECOND dot rather than the last segment, because
// gclid/gbraid can in theory contain a dot themselves — taking only the
// last segment would truncate it in that case.
function extractAfterSecondDot(raw) {
  if (!raw) return null;
  const firstDot = raw.indexOf('.');
  if (firstDot < 0) return null;
  const secondDot = raw.indexOf('.', firstDot + 1);
  if (secondDot < 0) return null;
  const value = raw.substring(secondDot + 1);
  return value || null;
}

async function getMarketingCookies() {
  if (typeof browser === 'undefined' || !browser?.cookie?.get) {
    if (isLog) console.warn('COOKIE: browser.cookie is not available — continuing with empty values');
    return { fbc: null, fbp: null, gclid: null, gcl_aw_raw: null, gbraid: null, gcl_gb_raw: null, ttp: null };
  }

  // Read all cookies in PARALLEL (Promise.all) — reading them
  // sequentially would add each one's wait time on top of the last,
  // increasing total latency.
  const [fbc, fbp, gclAw, gclGb, ttp] = await Promise.all([
    safeGetCookie('_fbc'),
    safeGetCookie('_fbp'),
    safeGetCookie('_gcl_aw'),   // gclid lives here
    safeGetCookie('_gcl_gb'),   // gbraid lives here (iOS/app campaigns)
    safeGetCookie('_ttp')
  ]);

  const gclid = extractAfterSecondDot(gclAw);
  const gbraid = extractAfterSecondDot(gclGb);
  const result = {
    fbc, fbp, ttp,
    gclid, gcl_aw_raw: gclAw,
    gbraid, gcl_gb_raw: gclGb
  };

  if (isLog) console.log('COOKIE: values read ->', result);
  return result;
}

// No well-documented, widely-recognized cookie name was found for
// wbraid specifically (low confidence) — so we only read it from the
// URL. UTM parameters work the same way: there's no standard cookie for
// these either; they're only read if they happen to still be present in
// the checkout URL. IN MOST CASES THESE ARE EXPECTED TO BE `null` — by
// the time checkout is reached, these parameters have usually already
// disappeared from the URL (unless persisted, see the ATTRIBUTION
// PERSISTENCE section below for how we work around this). Not a bug,
// just a limitation of URL-only reading.
function getUrlBasedSignals(url) {
  let params;
  try {
    params = new URL(url).searchParams;
  } catch (err) {
    if (isLog) console.warn('URL: could not be parsed ->', url, err);
    return { wbraid: null, utm_source: null, utm_medium: null, utm_campaign: null, utm_term: null, utm_content: null };
  }

  const result = {
    wbraid: params.get('wbraid') || null,
    utm_source: params.get('utm_source') || null,
    utm_medium: params.get('utm_medium') || null,
    utm_campaign: params.get('utm_campaign') || null,
    utm_term: params.get('utm_term') || null,
    utm_content: params.get('utm_content') || null,
  };

  if (isLog) console.log('URL: signals ->', result);
  return result;
}

// =======================================================================
// PART 3 — ATTRIBUTION (UTM + Click-ID) PERSISTENCE via browser.localStorage
// =======================================================================
// UTM/click-ID parameters live in the URL on the storefront, but they're
// gone by the time the customer reaches checkout. To bridge that gap, we
// persist them to localStorage (via Shopify's sanctioned async
// browser.localStorage API, which reaches the real top-frame storage,
// same as browser.cookie) and restore them at checkout.
//
// This piggybacks on the EXISTING page_viewed subscription that already
// runs on every storefront page (see the `else` branch further down) —
// no separate theme script or code on the storefront is required. When
// a storefront page_viewed event carries UTM/click-ID parameters in its
// URL, they get merged into localStorage; at checkout, we simply read
// whatever's there (within the TTL window).
//
// 30-minute TTL — a reasonable default for session-scoped attribution.
// If your typical browse-to-checkout time is longer, consider raising
// ATTR_TTL_MS (note this is shorter than typical 7–28 day ad-platform
// click windows — this only bridges the storefront-to-checkout gap
// within a single session, not long-term attribution).

const ATTR_KEY = 'shopify_pixel_attr_v1';
const ATTR_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function persistAttribution(url) {
  try {
    const params = new URL(url).searchParams;
    const raw = await browser.localStorage.getItem(ATTR_KEY);
    let stored = {};
    try { stored = raw ? JSON.parse(raw) : {}; } catch (e) {}
    const fresh = {
      utm_source: params.get('utm_source'),
      utm_medium: params.get('utm_medium'),
      utm_campaign: params.get('utm_campaign'),
      utm_term: params.get('utm_term'),
      utm_content: params.get('utm_content'),
      gclid: params.get('gclid'),
      fbclid: params.get('fbclid'),
      wbraid: params.get('wbraid'),
    };
    // Only overwrite a stored field if the fresh URL actually has a
    // value for it — a param missing from the new URL doesn't erase a
    // previously captured one.
    const merged = { ...stored };
    for (const [key, value] of Object.entries(fresh)) {
      if (value !== null && value !== undefined && value !== '') {
        merged[key] = value;
      }
    }
    merged.saved_at = Date.now();
    await browser.localStorage.setItem(ATTR_KEY, JSON.stringify(merged));
    if (isLog) console.log('ATTR: saved ->', merged);
  } catch (err) {
    if (isLog) console.warn('ATTR: error while saving ->', err);
  }
}

async function getAttribution() {
  try {
    const raw = await browser.localStorage.getItem(ATTR_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (Date.now() - (parsed.saved_at || 0) > ATTR_TTL_MS) {
      await browser.localStorage.removeItem(ATTR_KEY);
      if (isLog) console.log('ATTR: 30 minutes elapsed, cleared');
      return {};
    }
    const { saved_at, ...rest } = parsed;
    return rest;
  } catch (err) {
    if (isLog) console.warn('ATTR: error while reading ->', err);
    return {};
  }
}

async function prepareDataLayerObject(event, eventName) {
  if (isLog) {
    console.log('event', event);
  }

  const ecomm_pagetype = getPageType();
  const ecom = parseEcomParams(event);
  ecom.items = parseItems(event);
  const userData = parseUserData(event);
  const cart_state = getCart(initContext?.data?.cart || {});
  const market = extractMarketData(event);
  const marketingCookies = await getMarketingCookies();

  // === URL cleanup (strip a stray trailing "]" observed in testing) ===
  // NOTE: root cause not fully confirmed, but this sanitization was found
  // to be empirically necessary — kept as a defensive safeguard.
  const rawUrl = event?.context?.document?.location?.href ||
    initContext?.context?.document?.location?.href ||
    href;
  const currentUrl = rawUrl.replace(/\]$/, '');

  // === Attribution parameters from the current URL ===
  const urlParams = new URL(currentUrl).searchParams;
  const currentUtmSource = urlParams.get('utm_source');
  const currentGclid = urlParams.get('gclid');

  // === If the storefront URL carries fresh attribution, persist it ===
  if (currentUtmSource || currentGclid || urlParams.get('utm_medium') || urlParams.get('fbclid') || urlParams.get('wbraid')) {
    await persistAttribution(currentUrl);
  }

  // === Restore previously stored attribution (checkout fallback) ===
  const stored = await getAttribution();

  // === Final merge priority: current URL > localStorage > cookie (gclid only) > null ===
  const utm_source = currentUtmSource || stored.utm_source || null;
  const utm_medium = urlParams.get('utm_medium') || stored.utm_medium || null;
  const utm_campaign = urlParams.get('utm_campaign') || stored.utm_campaign || null;
  const utm_term = urlParams.get('utm_term') || stored.utm_term || null;
  const utm_content = urlParams.get('utm_content') || stored.utm_content || null;
  const gclid = currentGclid || stored.gclid || marketingCookies.gclid || null;
  const wbraid = urlParams.get('wbraid') || stored.wbraid || null;
  const fbclid = urlParams.get('fbclid') || stored.fbclid || null;

  if (isLog && (utm_source || stored.utm_source)) {
    console.log('ATTR: merge ->', { current: currentUtmSource, stored: stored.utm_source, final: utm_source });
  }

  let obj = {
    event: event_name[eventName],
    event_id: generateEventId(event, eventName),
    user_data: clearObj(userData),
    cart_state,
    ecomm_pagetype,
    actual_url: currentUrl,
    // PART 2: marketing click-IDs
    fbc: marketingCookies.fbc,
    fbp: marketingCookies.fbp,
    gclid: gclid,
    gbraid: marketingCookies.gbraid,
    ttp: marketingCookies.ttp,
    // PART 2b: URL-based signals + localStorage fallback
    wbraid: wbraid,
    utm_source: utm_source,
    utm_medium: utm_medium,
    utm_campaign: utm_campaign,
    utm_term: utm_term,
    utm_content: utm_content,
    fbclid: fbclid,
    // For an explicit, server-side-checkable filter
    consent: event?.consent || currentConsentState,
  };

  if ([
    'checkout_completed',
    'payment_info_submitted',
    'checkout_started',
    'checkout_shipping_info_submitted',
    'checkout_contact_info_submitted'
  ].includes(eventName)) {
    obj.checkout_token = event?.data?.checkout?.token;
  }

  if (eventName === 'checkout_completed' && obj.user_data) {
    obj.user_data.customer_lifetime_value = Number(
      (
        (Number(customerShopStape?.total_spent) || 0) +
        (Number(event?.data?.checkout?.totalPrice?.amount) || 0)
      ).toFixed(2)
    );
  }

  if ([
    'checkout_completed',
    'payment_info_submitted',
    'checkout_started',
    'checkout_shipping_info_submitted',
    'checkout_contact_info_submitted'
  ].includes(eventName)) {
    obj.delivery = getDelivery(event);
  }

  if (['checkout_completed', 'payment_info_submitted'].includes(eventName)) {
    ecom.payment_type = event?.data?.checkout?.transactions?.[0]?.paymentMethod?.type;
  }

  if (['alert_displayed', 'ui_extension_errored'].includes(eventName)) {
    obj = { ...obj, ...(event?.data?.alert || {}) };
  }

  if (eventName !== 'page_viewed') obj.ecommerce = ecom;
  if (market.id) obj.market_id = market.id;
  if (market.handle) obj.market_handle = market.handle;

  return obj;
}

async function handleAnalyticsEvent(event) {
  const eventName = event.name;
  const isPageViewed = eventName === "page_viewed";

  const data = await prepareDataLayerObject(event, eventName);
  if (isLog) {
    console.log('Send event data', data);
  }

  const pushData = () => {
    if (isCheckoutPage) {
      // Checkout page: push everything to dataLayer
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(data);
    } else if (isPageViewed) {
      // Non-checkout page: only relay page_viewed to the parent window
      // (this is also where attribution gets captured into localStorage,
      // see PART 3 above — persistAttribution runs inside
      // prepareDataLayerObject for every storefront page_viewed)
      window.parent.postMessage(data, location.origin);
    }
    // No push happens for other event types outside checkout
  };

  setTimeout(pushData, 500);
}

if (canSubscribe) {

  if (isCheckoutPage) {
    initConsentMode();

    if (!useMultyMarkets) {
      loadGTM();
    }

    analytics.subscribe("all_standard_events", (event) => {
      const marketId = event?.data?.checkout?.localization?.market?.id;
      if (useMultyMarkets && marketId) {
        loadGTM(marketId);
      }
      if (sandbox_events.includes(event.name) || event.name === 'page_viewed') {
        handleAnalyticsEvent(event).catch((err) => console.error('handleAnalyticsEvent error:', err));
      }
    });
  } else {
    analytics.subscribe("page_viewed", (event) => {
      handleAnalyticsEvent(event).catch((err) => console.error('handleAnalyticsEvent error:', err));
    });
  }
}

function getPageType() {
  const path = initContext?.context?.document?.location?.pathname || '';

  if (path.includes('/collection')) { return 'category'; }
  else if (path.includes('/product')) { return 'product'; }
  else if (path.includes('/cart')) { return 'basket'; }
  else if (path === '/') { return 'home'; }
  else if (path.includes('thank_you') || path.includes('thank-you')) { return 'purchase'; }
  else if (path.includes('/checkout')) { return 'basket'; }
  else { return 'other'; }
}
// -----------------------------------------------------------------------
// loadGTM — Stape's first-party (custom subdomain) GTM loader code. This
// part is unchanged in behavior — it already runs through your own
// personal subdomain (data.farruxbek.online), so it's resistant to
// adblockers. Only this function remains from Stape's original
// implementation; the old wrapper that fetched from sp.stapecdn.com has
// been fully removed.
// -----------------------------------------------------------------------
function loadGTM(key) {

  if (isInsertGTM) return;
  isInsertGTM = true;

  // Note: this used to have 3 different `case` branches keyed by `key`
  // (market ID), but all three were byte-for-byte identical, and since
  // useMultyMarkets is currently `false`, execution always fell through
  // to `default` anyway — the duplicated dead code was removed.
  //
  // The code below is Stape's minified GTM loader snippet, rewritten
  // with THE EXACT SAME LOGIC but with readable, non-colliding variable
  // names. Reason: during minification, the same short name (d, g, v, E,
  // f) was reused twice within a single function — this isn't a JS error
  // (`var` allows redeclaration like this), but Shopify's editor checker
  // flagged it as "already defined" / "used out of scope". Every step
  // was checked against the original — the domain, container ID, and
  // query string are unchanged.
  !function () {
    "use strict";

    function getCookieValue(name) {
      var cookies = document.cookie.split(";");
      for (var idx = 0; idx < cookies.length; idx++) {
        var pair = cookies[idx].split("=");
        if (pair[0].trim() === name) return pair[1];
      }
    }

    function getLocalStorageValue(key) {
      return localStorage.getItem(key);
    }

    function getWindowValue(varName) {
      return window[varName];
    }

    function getCssSelectorValue(selector, attribute) {
      var el = document.querySelector(selector);
      if (!el) return undefined;
      return attribute ? el.getAttribute(attribute) : el.textContent;
    }

    function resolveUid(source, keys, attribute) {
      if (typeof keys === "undefined") keys = "";
      var resolvers = {
        cookie: getCookieValue,
        localStorage: getLocalStorageValue,
        jsVariable: getWindowValue,
        cssSelector: getCssSelectorValue
      };
      var keyList = Array.isArray(keys) ? keys : [keys];
      if (source && resolvers[source]) {
        var resolve = resolvers[source];
        for (var k = 0; k < keyList.length; k++) {
          var value = attribute ? resolve(keyList[k], attribute) : resolve(keyList[k]);
          if (value) return value;
        }
      } else {
        console.warn("invalid uid source", source);
      }
    }

    // ---- Stape configuration (original values, unchanged) ----
    var GTM_LOADER_DOMAIN = "https://data.farruxbek.online";
    var GTM_LOADER_DOMAIN_FALLBACK = "";
    var CONTAINER_ID = "3sibtwmwlxmfa";
    var QUERY_STRING = "59wwwf=CAJQPzg6QEI1JStBVSQ9URdbX1ZdUQkZXAAMCh4CFRUEDUMXAhsEGQQ%3D";
    var UID_SOURCE = "jsVariable";
    var UID_KEY = "_sbp";
    var UID_ATTRIBUTE = "";

    var isSafariIOS16Plus = false;
    var uidValue;
    var isStapeUserId = false;

    try {
      var uaMatch = new RegExp("Version/([0-9._]+)(.*Mobile)?.*Safari.*").exec(navigator.userAgent);
      isSafariIOS16Plus = !!UID_SOURCE && !!uaMatch && 16.4 <= parseFloat(uaMatch[1]);
      isStapeUserId = "stapeUserId" === UID_SOURCE;
      uidValue = (isSafariIOS16Plus && !isStapeUserId) ?
        resolveUid(UID_SOURCE, UID_KEY, UID_ATTRIBUTE) :
        undefined;
      isSafariIOS16Plus = isSafariIOS16Plus && (!!uidValue || isStapeUserId);
    } catch (uidError) {
      console.error(uidError);
    }

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ "gtm.start": (new Date).getTime(), event: "gtm.js" });

    var firstScriptTag = document.getElementsByTagName("script")[0];
    var uidQueryParam = uidValue ? "&bi=" + encodeURIComponent(uidValue) : "";
    var scriptTag = document.createElement("script");

    var effectiveContainerId = CONTAINER_ID;
    if (isSafariIOS16Plus) {
      effectiveContainerId = 8 < CONTAINER_ID.length ?
        CONTAINER_ID.replace(/([a-z]{8}$)/, "kp$1") :
        "kp" + CONTAINER_ID;
    }
    var baseUrl = (!isSafariIOS16Plus && GTM_LOADER_DOMAIN_FALLBACK) ? GTM_LOADER_DOMAIN_FALLBACK : GTM_LOADER_DOMAIN;

    scriptTag.async = true;
    scriptTag.src = baseUrl + "/" + effectiveContainerId + ".js?" + QUERY_STRING + uidQueryParam;

    var parentNode = firstScriptTag && firstScriptTag.parentNode;
    if (parentNode) parentNode.insertBefore(scriptTag, firstScriptTag);
  }();
}


function parseItems(event) {

  let items = [];

  if (event.data?.checkout?.lineItems) {
    for (let i = 0; i < event.data.checkout.lineItems.length; i++) {
      const lineItem = event.data.checkout.lineItems[i];
      const sellingPlanAllocation = lineItem.sellingPlanAllocation;

      const item = {
        item_id: lineItem.variant.product.id,
        item_sku: lineItem.variant.sku,
        item_variant: lineItem.variant.id,
        item_name: lineItem.variant.product.title,
        variant_name: lineItem.variant.title,
        item_category: lineItem.variant.product.type,
        item_brand: lineItem.variant.product.vendor,
        item_url: lineItem.variant.product?.url,
        price: lineItem.variant.price.amount,
        imageURL: lineItem?.variant?.image?.src,
        discount: lineItem.discountAllocations[0]?.amount?.amount || null,
        quantity: lineItem.quantity,
        index: i + 1,
      };

      if (sellingPlanAllocation && sellingPlanAllocation.sellingPlan?.id) {
        const { id, name } = sellingPlanAllocation.sellingPlan;
        if (id) {
          const sellingPlanId = id.split('/').pop();
          if (sellingPlanId) {
            item.item_selling_plan_id = sellingPlanId;
          }
        }
        if (name) {
          const sellingPlanName = name || null;
          if (sellingPlanName) {
            item.item_selling_plan_name = sellingPlanName;
          }
        }
      }

      items.push(item);
    }
  }

  if (event.data?.cartLine?.merchandise) {
    items.push({
      'item_id': event.data.cartLine.merchandise.product.id,
      'item_sku': event.data.cartLine.merchandise.sku,
      'item_variant': event.data.cartLine.merchandise.id,
      'item_name': event.data.cartLine.merchandise.product.title,
      'variant_name': event.data.cartLine.merchandise.title,
      'item_category': event.data.cartLine.merchandise.product.type,
      'item_brand': event.data.cartLine.merchandise.product.vendor,
      'item_url': event.data.cartLine.merchandise.product?.url,
      'price': event.data.cartLine.merchandise.price.amount,
      'imageURL': event.data.cartLine.merchandise?.image?.src,
      'quantity': event.data.cartLine.quantity
    });
  }

  if (event.data?.productVariant) {
    items.push({
      'item_id': event.data.productVariant.product.id,
      'item_sku': event.data.productVariant.sku,
      'item_variant': event.data.productVariant.id,
      'item_name': event.data.productVariant.product.title,
      'variant_name': event.data.productVariant.title,
      'item_category': event.data.productVariant.product.type,
      'price': event.data.productVariant.price.amount,
      'item_brand': event.data.productVariant.product.vendor,
      'imageURL': event.data.productVariant?.image?.src,
      'item_url': event.data.productVariant?.product?.url,
      'quantity': '1'
    });
  }

  if (event.data?.collection?.productVariants) {
    for (let i = 0; i < event.data?.collection?.productVariants.length; i++) {
      const variant = event.data.collection.productVariants[i];
      items.push({
        item_id: variant.product.id,
        item_sku: variant.sku,
        item_variant: variant.id,
        item_name: variant.product.title,
        variant_name: variant.title,
        item_category: variant.product.type,
        item_brand: variant.product.vendor,
        price: variant.price.amount,
        imageURL: variant?.image?.src,
        item_url: variant?.product?.url,
        index: i + 1,
      });
    }
  }

  // Parse search result product variants
  if (event.data?.searchResult?.productVariants) {
    for (let i = 0; i < event.data.searchResult.productVariants.length; i++) {
      const variant = event.data.searchResult.productVariants[i];
      items.push({
        item_id: variant.product.id,
        item_sku: variant.sku,
        item_variant: variant.id,
        item_name: variant.product.title,
        variant_name: variant.title,
        item_category: variant.product.type,
        item_brand: variant.product.vendor,
        price: variant.price.amount,
        imageURL: variant?.image?.src,
        item_url: variant?.product?.url,
        index: i + 1,
      });
    }
  }

  if (event.data?.cart?.lines) {
    for (let i = 0; i < event.data.cart.lines.length; i++) {
      const line = event.data.cart.lines[i];
      items.push({
        item_id: line.merchandise.product.id,
        item_sku: line.merchandise.sku,
        item_variant: line.merchandise.id,
        item_name: line.merchandise.product.title,
        variant_name: line.merchandise.title,
        item_category: line.merchandise.product.type,
        item_brand: line.merchandise.product.vendor,
        item_url: line.merchandise?.product?.url,
        price: line.merchandise.price.amount,
        imageURL: line.merchandise?.image?.src,
        quantity: line.quantity,
        index: i + 1,
      });
    }
  }

  try {
    if (window?.productShopStape?.variants) {
      const variants = window.productShopStape.variants;
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        for (let vIndex = 0; vIndex < variants.length; vIndex++) {
          const variant = variants[vIndex];
          if (variant?.id == item?.item_variant && variant?.compare_at_price) {
            items[index].compare_at_price = (variant.compare_at_price / 100) + '';
          }
        }
      }
    }

    if (window?.collectionShopStape?.products) {
      const products = window.collectionShopStape.products;
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        for (let pIndex = 0; pIndex < products.length; pIndex++) {
          const productVariants = products[pIndex]?.variants || [];
          for (let vIndex = 0; vIndex < productVariants.length; vIndex++) {
            const variant = productVariants[vIndex];
            if (variant?.id == item?.item_variant && variant?.compare_at_price) {
              items[index].compare_at_price = variant.compare_at_price + '';
            }
          }
        }
      }
    }

    if (localStorage && localStorage?.getItem('addedProductStape')) {
      let addedProductStape = [];
      try {
        addedProductStape = JSON.parse(localStorage.getItem('addedProductStape')) || [];
      } catch (error) {}

      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        for (let aIndex = 0; aIndex < addedProductStape.length; aIndex++) {
          const addedItem = addedProductStape[aIndex];
          if (addedItem?.item_variant == item?.item_variant && addedItem.compare_at_price) {
            items[index].compare_at_price = addedItem.compare_at_price + '';
          }
        }
      }
    }
  } catch (error) {}

  return items;
}


function parseEcomParams(event) {

  let ecom = {};

  if (event?.data?.checkout?.totalPrice?.hasOwnProperty('amount')) {
    ecom.value = event?.data?.checkout?.totalPrice?.amount?.toString();
    ecom.cart_total = event?.data?.checkout?.totalPrice?.amount?.toString();
    ecom.currency = event?.data?.checkout?.totalPrice?.currencyCode;
    ecom.cart_quantity = event?.data?.checkout?.lineItems?.length;
  }

  if (event.name == "checkout_completed") {
    ecom.tax = event?.data?.checkout?.totalTax?.amount;
    ecom.shipping = event?.data?.checkout?.shippingLine?.price?.amount;
    ecom.transaction_id = event?.data?.checkout?.order?.id;
    ecom.coupon = event?.data?.checkout?.discountApplications[0]?.title;
    ecom.discount = event?.data?.checkout?.discountApplications[0]?.title;
    ecom.discount_amount = event?.data?.checkout?.discountApplications[0]?.value?.amount;
    ecom.discount_percentage = event?.data?.checkout?.discountApplications[0]?.value?.percentage;
    ecom.sub_total = event?.data?.checkout?.subtotalPrice?.amount;
  }

  if (event.name == "collection_viewed") {
    ecom.collection_id = event?.data?.collection?.id + '';
    ecom.item_list_id = event?.data?.collection?.id + '';
    ecom.item_list_name = event?.data?.collection?.title;
    ecom.currency = event?.data?.collection?.productVariants[0]?.price?.currencyCode;
  }

  if (event.name == "search_submitted") {
    ecom.search_term = event?.data?.searchResult?.query;
    ecom.currency = event?.data?.searchResult?.productVariants[0]?.price?.currencyCode;
  }

  if (event.name == "cart_viewed") {
    ecom.value = event?.data?.cart?.cost?.totalAmount?.amount?.toString();
    ecom.currency = event?.data?.cart?.cost?.totalAmount?.currencyCode;
  }

  if (event.name == "product_viewed") {
    ecom.value = event?.data?.productVariant?.price?.amount?.toString();
    ecom.currency = event?.data?.productVariant?.price?.currencyCode;
  }

  if (event.name == "product_added_to_cart") {
    ecom.value = (event?.data?.cartLine?.cost?.totalAmount?.amount * 1).toFixed(2);
    ecom.currency = event?.data?.cartLine?.cost?.totalAmount?.currencyCode;
  }

  if (event.name == "product_removed_from_cart") {
    ecom.value = (event?.data?.cartLine?.cost?.totalAmount?.amount * 1).toFixed(2);
    ecom.currency = event?.data?.cartLine?.cost?.totalAmount?.currencyCode;
  }

  return ecom;

}


function getCart(cart = {}) {
  const tmp = {
    cart_id: cart.id || null,
    cart_quantity: cart.totalQuantity || 0,
    cart_value: cart.cost?.totalAmount?.amount || 0,
    currency: cart.cost?.totalAmount?.currencyCode,
    lines: (cart.lines || []).map(_i => ({
      item_variant: _i.merchandise.id,
      item_id: _i.merchandise.product.id,
      item_sku: _i.merchandise.sku,
      item_name: _i.merchandise.product.title,
      quantity: _i.quantity,
      line_total_price: _i.cost.totalAmount.amount,
      price: _i.merchandise.price.amount,
    }))

  };
  return tmp;
}


function getDelivery(event) {
  const data = {};

  const shippingAmount = event?.data?.checkout?.delivery?.selectedDeliveryOptions[0]?.cost?.amount || 0;
  const costAfterDiscounts = event?.data?.checkout?.delivery?.selectedDeliveryOptions[0]?.costAfterDiscounts?.amount || 0;

  data.shipping_tier = event?.data?.checkout?.delivery?.selectedDeliveryOptions[0]?.title || '';
  data.shipping_amount = shippingAmount;
  data.currency = event?.data?.checkout?.delivery?.selectedDeliveryOptions[0]?.cost?.currencyCode;
  data.address_province_code = event?.data?.checkout?.shippingAddress?.provinceCode ? event?.data?.checkout.shippingAddress.provinceCode : null;
  data.address_zip = event?.data?.checkout?.shippingAddress?.zip ? event?.data?.checkout.shippingAddress.zip : null;
  data.delivery_method_type = event?.data?.checkout?.delivery?.selectedDeliveryOptions[0]?.type || "shipping";
  data.shipping_discount_amount = shippingAmount - costAfterDiscounts;

  return data;
}


function parseUserData(event) {
  let userData = {};

  userData.first_name = event.data?.checkout?.billingAddress?.firstName ? event.data.checkout.billingAddress.firstName : event.data?.checkout?.shippingAddress?.firstName ? event.data.checkout.shippingAddress.firstName : initContext?.data?.customer?.firstName ? initContext.data.customer.firstName : null;
  userData.last_name = event.data?.checkout?.billingAddress?.lastName ? event.data.checkout.billingAddress.lastName : event.data?.checkout?.shippingAddress?.lastName ? event.data.checkout.shippingAddress.lastName : initContext?.data?.customer?.lastName ? initContext.data.customer.lastName : null;
  userData.email = event.data?.checkout?.email ? event.data.checkout.email : initContext?.data?.customer?.email ? initContext.data.customer.email : null;
  userData.phone = event.data?.checkout?.billingAddress?.phone ? event.data.checkout.billingAddress.phone : event.data?.checkout?.shippingAddress?.phone ? event.data.checkout.shippingAddress.phone : initContext?.data?.customer?.phone ? initContext.data.customer.phone : null;
  userData.city = event.data?.checkout?.billingAddress?.city ? event.data.checkout.billingAddress.city : event.data?.checkout?.shippingAddress?.city ? event.data.checkout.shippingAddress.city : null;
  userData.country = event.data?.checkout?.billingAddress?.countryCode ? event.data.checkout.billingAddress.countryCode : event.data?.checkout?.shippingAddress?.countryCode ? event.data.checkout.shippingAddress.countryCode : null;
  userData.zip = event.data?.checkout?.billingAddress?.zip ? event.data.checkout.billingAddress.zip : event.data?.checkout?.shippingAddress?.zip ? event.data.checkout.shippingAddress.zip : null;
  userData.region = event.data?.checkout?.billingAddress?.provinceCode ? event.data.checkout.billingAddress.provinceCode : event.data?.checkout?.shippingAddress?.provinceCode ? event.data.checkout.shippingAddress.provinceCode : null;
  userData.street = event.data?.checkout?.billingAddress?.address1 ? event.data.checkout.billingAddress.address1 : event.data?.checkout?.shippingAddress?.address1 ? event.data.checkout.shippingAddress.address1 : null;
  userData.customer_id = initContext?.data?.customer?.id || event?.data?.checkout?.order?.customer?.id ? initContext?.data?.customer?.id || event?.data?.checkout?.order?.customer?.id : null;
  userData.new_customer = event?.data?.checkout?.order?.customer?.isFirstOrder;

  userData.shopify_client_id = event?.clientId;

  return userData;
}
