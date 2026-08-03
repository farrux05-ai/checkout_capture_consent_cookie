/**
 * ============================================================================
 * CUSTOM PIXEL — Checkout Events → Stape GTM (first-party subdomain)
 * ============================================================================
 *
 * ORIGINAL CHANGES (v1):
 * 1) Removed fetch() to Stape App's shared CDN (sp.stapecdn.com) — adblock risk.
 *    Only loadGTM() remains, loading GTM from your first-party subdomain.
 * 2) event_id is generated in exactly one place (generateEventId()) and written
 *    to the dataLayer once, so client pixel tags and the server Data Tag always
 *    read the same value — required for correct Meta/TikTok deduplication.
 * 3) checkout_completed (purchase) uses a STABLE event_id built from order.id,
 *    so a thank-you page reload never double-counts a purchase.
 * 4) Every other event uses event.id (Shopify guarantees uniqueness per
 *    dispatch per the Web Pixels API).
 *
 * ----------------------------------------------------------------------------
 * UPDATE 2 — THIS PASS:
 *
 * A) ATTRIBUTION PERSISTENCE MOVED FROM localStorage TO A COOKIE KEEPER
 *    CUSTOM COOKIE.
 *    The old PART 3 wrote UTM/click-ID params into browser.localStorage with
 *    a hardcoded 30-minute TTL. That's fragile: it only bridges a single
 *    session on the same device, and it re-invents what Stape's Cookie
 *    Keeper power-up already does properly (extends cookie lifetime past
 *    Safari ITP's cap, restores cookies via a server response so the
 *    checkout sandbox can see them).
 *    Now we write the SAME attribution data into a first-party cookie named
 *    `_stape_attr` via browser.cookie.set(). You must add this exact name
 *    (`_stape_attr`) as a "custom cookie" in Stape's Cookie Keeper power-up
 *    panel (Power-ups → Cookie Keeper → Custom cookies) so Stape keeps
 *    extending/restoring it the same way it already does for _fbp, _fbc,
 *    _gcl_aw, _gcl_gb, _ttp. Set an expiration there that matches your
 *    attribution window (e.g. 30 days) — you no longer need to hardcode a
 *    TTL in this script.
 *
 * B) EACH DATALAYER FIELD IS NOW ITS OWN NAMED VARIABLE.
 *    prepareDataLayerObject() used to build most fields inline inside one
 *    big object literal. Every core field (event_id, user_data, actual_url,
 *    gclid, fbclid, etc.) is now computed into its own const first, and the
 *    object literal just references them. Easier to console.log or debug
 *    any single field in isolation.
 *
 * C) UTM PARAMETERS ARE NO LONGER SEPARATE DATALAYER FIELDS.
 *    utm_source / utm_medium / utm_campaign / utm_term / utm_content used to
 *    be five separate keys in the pushed object. They are now appended as
 *    query parameters onto `actual_url` instead (only if not already
 *    present there). Your server container (GA4 / Ads tags that read
 *    page_location, or a URL-parsing variable in sGTM) can keep extracting
 *    them from the URL exactly like it already does for a normal
 *    client-side hit — one field carries everything, and there's one fewer
 *    thing that can silently go missing on a specific tag.
 *    Click IDs (gclid, fbclid, wbraid) are NOT folded into the URL — Ads/
 *    Meta CAPI-style server tags usually expect these as dedicated fields
 *    for exact matching, so they stay as their own variables below.
 *
 * D) CONSENT SUBSCRIBE FIX.
 *    The bare `customerPrivacy` global is not guaranteed in the Custom
 *    Pixel code-editor context — Shopify's own docs only list analytics,
 *    browser and init as pre-deconstructed. Real working examples call
 *    `api.customerPrivacy.subscribe(...)` off the global `api` object
 *    instead. getCustomerPrivacyApi() below now tries the bare global
 *    first (in case Shopify ever exposes it directly) and falls back to
 *    `api.customerPrivacy`. If BOTH are missing, the most common secondary
 *    cause is a CMP that deletes Shopify's own `_tracking_consent` cookie —
 *    the Customer Privacy API reads its state from that cookie, so if your
 *    CMP purges it, the API silently stops working. Worth excluding
 *    `_tracking_consent` from any cookie-blocking rule in your CMP.
 *
 * ----------------------------------------------------------------------------
 * REQUIRED GTM-SIDE SETUP (unchanged from v1):
 *
 *   a) In GTM, create a Data Layer Variable "DLV - event_id" (Data Layer
 *      Variable Name: event_id).
 *   b) In every Meta / TikTok / Data Tag, bind "Event ID" to
 *      {{DLV - event_id}}, and turn off any "Auto-generate Event ID" toggle.
 *   c) In Shopify Admin → Settings → Customer events, disable/remove
 *      Stape App's own auto-installed pixel if it's still active — two
 *      pixels running together will double every event.
 *
 * REQUIRED STAPE-SIDE SETUP (new, for this pass):
 *
 *   d) Power-ups → Cookie Keeper → Custom cookies → add cookie name
 *      `_stape_attr`, set an expiration (e.g. 30 days).
 * ============================================================================
 */

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
//   - customerPrivacy.subscribe(...)   -> subsequent changes (see
//     getCustomerPrivacyApi() below for how this is actually resolved)
// This depends on Shopify Admin -> Settings -> Customer Privacy, NOT on
// your CMP's own settings — verify the two are aligned separately.
//
// VERIFYING (after adding this piece, open the console on checkout):
//   1. Look for "CONSENT: initial privacy snapshot" — confirms a real
//      customerPrivacy object is arriving.
//   2. Look for "CONSENT: default pushed" — shows exactly which values
//      (granted/denied) were sent.
//   3. Look for "CONSENT: subscribed via <source>" — confirms which of the
//      two access paths worked (bare global vs api.customerPrivacy).
//   4. If checkout shows a consent banner and you interact with it —
//      "CONSENT: update pushed" should fire.

window.dataLayer = window.dataLayer || [];

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
    functionality_storage: 'granted',
    security_storage: 'granted'
  };
}

let currentConsentState = null;

/**
 * Resolves a working customerPrivacy.subscribe() reference.
 *
 * Shopify's own docs (Web Pixels API) only guarantee analytics, browser,
 * and init as pre-deconstructed globals in the Custom Pixel code editor —
 * customerPrivacy is notably absent from that list. Working real-world
 * pixel code instead calls it off the global `api` object:
 * api.customerPrivacy.subscribe(...). We try the bare global first (in
 * case a future Shopify version does expose it directly) and fall back to
 * api.customerPrivacy.
 */
function getCustomerPrivacyApi() {
  try {
    if (typeof customerPrivacy !== 'undefined' && customerPrivacy && typeof customerPrivacy.subscribe === 'function') {
      return { api: customerPrivacy, source: 'bare customerPrivacy global' };
    }
  } catch (e) {}

  try {
    if (typeof api !== 'undefined' && api?.customerPrivacy && typeof api.customerPrivacy.subscribe === 'function') {
      return { api: api.customerPrivacy, source: 'api.customerPrivacy' };
    }
  } catch (e) {}

  return null;
}

function initConsentMode() {
  const initialPrivacy = initContext?.customerPrivacy;
  if (isLog) console.log('CONSENT: initial privacy snapshot', initialPrivacy);

  // 1) Default state BEFORE GTM loads — required so tags that fire the
  //    instant GTM initializes don't fire without any consent state.
  const defaultConsent = mapConsentToGtag(initialPrivacy);
  currentConsentState = defaultConsent;
  gtag('consent', 'default', Object.assign({}, defaultConsent, { wait_for_update: 500 }));
  if (isLog) console.log('CONSENT: default pushed ->', defaultConsent);

  // 2) Live updates — resolve a working API reference instead of assuming
  //    a bare `customerPrivacy` global exists.
  const resolved = getCustomerPrivacyApi();

  if (!resolved) {
    if (isLog) {
      console.warn(
        'CONSENT: no working customerPrivacy API found (checked bare "customerPrivacy" ' +
        'and "api.customerPrivacy") — staying on default only. If this keeps happening, ' +
        'also check that your CMP is not deleting Shopify\'s own "_tracking_consent" cookie: ' +
        'the Customer Privacy API reads its live state from that cookie, so a CMP that blocks ' +
        'or clears it will make subscribe() silently do nothing even when the API object exists.'
      );
    }
    return;
  }

  if (isLog) console.log('CONSENT: subscribed via', resolved.source);

  resolved.api.subscribe('visitorConsentCollected', (event) => {
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
 * event_id generator — single source of truth.
 */
function generateEventId(event, eventName) {
  if (eventName === 'checkout_completed') {
    const orderId = extractNumericId(event?.data?.checkout?.order?.id);
    if (orderId) return 'purchase_' + orderId;
    return 'purchase_' + (event?.data?.checkout?.token || event.id);
  }
  return eventName + '_' + event.id;
}

// =======================================================================
// PART 2 — READING MARKETING COOKIES (fbc, fbp, gclid, gbraid, ttp)
// =======================================================================
// document.cookie does NOT work in the checkout sandbox. Instead, Shopify
// provides an ASYNC, sanctioned API: browser.cookie.get(name) ->
// Promise<string>, which reaches the REAL top-frame cookie jar.
//
// _gcl_aw format: "GCL.<timestamp>.<value>" — value is everything after
// the SECOND dot.

async function safeGetCookie(name) {
  try {
    const value = await browser.cookie.get(name);
    return value || null;
  } catch (err) {
    if (isLog) console.warn('COOKIE: "' + name + '" could not be read ->', err);
    return null;
  }
}

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

  const [fbc, fbp, gclAw, gclGb, ttp] = await Promise.all([
    safeGetCookie('_fbc'),
    safeGetCookie('_fbp'),
    safeGetCookie('_gcl_aw'),
    safeGetCookie('_gcl_gb'),
    safeGetCookie('_ttp')
  ]);

  const gclid = extractAfterSecondDot(gclAw);
  const gbraid = extractAfterSecondDot(gclGb);
  const result = { fbc, fbp, ttp, gclid, gcl_aw_raw: gclAw, gbraid, gcl_gb_raw: gclGb };

  if (isLog) console.log('COOKIE: values read ->', result);
  return result;
}

// =======================================================================
// PART 3 — ATTRIBUTION (UTM + Click-ID) PERSISTENCE via Cookie Keeper
// =======================================================================
// UTM/click-ID parameters live in the URL on the storefront but are gone
// by the time the customer reaches checkout. Instead of bridging that gap
// with a homemade localStorage + TTL hack, we write the same values into
// a normal first-party cookie (`_stape_attr`) via Shopify's sanctioned
// browser.cookie.set() API, and let Stape's Cookie Keeper power-up do
// what it already does for _fbp/_fbc/_gcl_aw/_gcl_gb/_ttp: extend its
// lifetime past Safari ITP's cap and restore it across the checkout
// sandbox boundary via a server response.
//
// IMPORTANT: add `_stape_attr` as a custom cookie in Power-ups -> Cookie
// Keeper -> Custom cookies, with whatever expiration fits your
// attribution window. Without that step this still works for the current
// browser session, but won't get the extended-lifetime / cross-context
// restoration Cookie Keeper provides for the other cookies.

const ATTR_COOKIE_NAME = '_stape_attr';
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
const CLICK_ID_KEYS = ['gclid', 'fbclid', 'wbraid'];
const ATTR_KEYS = [...UTM_KEYS, ...CLICK_ID_KEYS];

function extractAttrParamsFromUrl(url) {
  let params;
  try {
    params = new URL(url).searchParams;
  } catch (err) {
    if (isLog) console.warn('ATTR: URL could not be parsed ->', url, err);
    return {};
  }
  const out = {};
  for (const key of ATTR_KEYS) {
    const value = params.get(key);
    if (value) out[key] = value;
  }
  return out;
}

async function saveAttributionCookie(url) {
  const fresh = extractAttrParamsFromUrl(url);
  if (Object.keys(fresh).length === 0) return; // nothing new — leave the cookie untouched

  try {
    const existingRaw = await safeGetCookie(ATTR_COOKIE_NAME);
    let existing = {};
    if (existingRaw) {
      try { existing = JSON.parse(decodeURIComponent(existingRaw)); } catch (e) {}
    }
    // Only overwrite a stored field if the fresh URL actually has a value
    // for it — a param missing from the new URL doesn't erase a
    // previously captured one.
    const merged = { ...existing, ...fresh };
    const cookieValue = encodeURIComponent(JSON.stringify(merged));

    // 30-day default expiry for the initial write; Cookie Keeper (once
    // configured, see comment above) takes over extending/restoring it
    // beyond this.
    await browser.cookie.set(ATTR_COOKIE_NAME + '=' + cookieValue + '; max-age=2592000');
    if (isLog) console.log('ATTR: saved to cookie ->', merged);
  } catch (err) {
    if (isLog) console.warn('ATTR: could not save cookie ->', err);
  }
}

async function readAttributionCookie() {
  const raw = await safeGetCookie(ATTR_COOKIE_NAME);
  if (!raw) return {};
  try {
    return JSON.parse(decodeURIComponent(raw));
  } catch (err) {
    if (isLog) console.warn('ATTR: could not parse stored cookie ->', err);
    return {};
  }
}

// Current URL always wins over what's stored in the cookie.
async function getAttribution(currentUrl) {
  const fresh = extractAttrParamsFromUrl(currentUrl);
  const stored = await readAttributionCookie();
  return { ...stored, ...fresh };
}

// Appends UTM params onto a URL (only the ones not already present there).
// Click IDs are deliberately NOT folded in here — see UPDATE 2 (C) above.
function buildEnrichedUrl(url, params) {
  if (!params || Object.keys(params).length === 0) return url;
  try {
    const urlObj = new URL(url);
    for (const [key, value] of Object.entries(params)) {
      if (value && !urlObj.searchParams.has(key)) {
        urlObj.searchParams.set(key, value);
      }
    }
    return urlObj.toString();
  } catch (err) {
    if (isLog) console.warn('ATTR: could not build enriched actual_url ->', err);
    return url;
  }
}

async function prepareDataLayerObject(event, eventName) {
  if (isLog) console.log('event', event);

  const ecomm_pagetype = getPageType();
  const ecom = parseEcomParams(event);
  ecom.items = parseItems(event);

  const user_data = clearObj(parseUserData(event));
  const cart_state = getCart(initContext?.data?.cart || {});
  const market = extractMarketData(event);
  const marketingCookies = await getMarketingCookies();

  // === URL cleanup (strip a stray trailing "]" observed in testing) ===
  const rawUrl = event?.context?.document?.location?.href ||
    initContext?.context?.document?.location?.href ||
    href;
  const currentUrl = rawUrl.replace(/\]$/, '');

  // === On storefront pages, capture fresh attribution into the cookie ===
  if (!isCheckoutPage) {
    await saveAttributionCookie(currentUrl);
  }

  // === Resolve attribution: current URL > _stape_attr cookie ===
  const attribution = await getAttribution(currentUrl);

  const utmParamsForUrl = {};
  for (const key of UTM_KEYS) {
    if (attribution[key]) utmParamsForUrl[key] = attribution[key];
  }

  const event_id = generateEventId(event, eventName);
  const actual_url = buildEnrichedUrl(currentUrl, utmParamsForUrl);
  const fbc = marketingCookies.fbc;
  const fbp = marketingCookies.fbp;
  const ttp = marketingCookies.ttp;
  const gbraid = marketingCookies.gbraid;
  const gclid = attribution.gclid || marketingCookies.gclid || null;
  const fbclid = attribution.fbclid || null;
  const wbraid = attribution.wbraid || null;
  const consent = event?.consent || currentConsentState;

  if (isLog) {
    console.log('ATTR: resolved ->', { actual_url, gclid, fbclid, wbraid, utmParamsForUrl });
  }

  let obj = {
    event: event_name[eventName],
    event_id,
    user_data,
    cart_state,
    ecomm_pagetype,
    actual_url,
    fbc,
    fbp,
    gclid,
    gbraid,
    ttp,
    wbraid,
    fbclid,
    consent,
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
  if (isLog) console.log('Send event data', data);

  const pushData = () => {
    if (isCheckoutPage) {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(data);
    } else if (isPageViewed) {
      window.parent.postMessage(data, location.origin);
    }
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
// loadGTM — Stape's first-party (custom subdomain) GTM loader code.
// Unchanged from v1.
// -----------------------------------------------------------------------
function loadGTM(key) {

  if (isInsertGTM) return;
  isInsertGTM = true;

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
