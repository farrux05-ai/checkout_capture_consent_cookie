/**
 * ============================================================================
 * CUSTOM PIXEL — Checkout Events → Stape sGTM
 * v6 — Shopify IDE linter ga to'liq mos.
 *      - window.initContext → initContext (init global)
 *      - window.dataLayer   → dataLayer
 *      - window.analytics   → analytics
 *      - barcha || multiline lar bir qatorga yig'ildi
 *      - event_id prefix olib tashlandi (checkout_completed bundan mustasno)
 * ============================================================================
 */

const initContext = init;

const GTM_ID  = '5TCF99SP';
const GTM_URL = 'https://data.farruxbek.online';

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
  "page_viewed":                      "page_view_stape",
  "payment_info_submitted":           "add_payment_info_stape",
  "checkout_started":                 "begin_checkout_stape",
  "checkout_shipping_info_submitted": "add_shipping_info_stape",
  "checkout_contact_info_submitted":  "add_contact_info_stape",
  "checkout_completed":               "purchase_stape",
  "alert_displayed":                  "alert_displayed_stape",
  "ui_extension_errored":             "ui_extension_errored_stape"
};

const data_layer = {"field_mapping_enabled":false,"field_mapping":{"item_id":{"prefix":"","data_points":[{"value":"product_id"}],"separator":""},"item_sku":{"prefix":"","data_points":[{"value":"sku"}],"separator":""},"item_brand":{"source":"vendor"},"item_category":{"source":"product_type"}},"ecommerce":true,"user_data":false,"log_event":false,"enable_checkout_error_tracking":true,"hide_sufix_stape":false};

const isLog           = true;
const useMultyMarkets = false;
let   isInsertGTM     = false;

const href           = initContext?.context?.document?.location?.href || "";
const isCheckoutPage = href.includes("/checkouts");
const canSubscribe   = analytics && typeof analytics.subscribe === "function";

let customerShopStape = {};
try {
  customerShopStape = JSON.parse(localStorage.getItem('customerShopStape')) || {};
} catch (e) {}

const clearObj = (obj = {}) =>
  Object.fromEntries(
    Object.entries(obj).filter(([_, v]) => v !== null && v !== undefined && v !== '')
  );

function extractNumericId(gid) {
  return gid ? String(gid).split('/').pop() : null;
}

// =======================================================================
// CONSENT MODE
// =======================================================================

window.dataLayer = window.dataLayer || [];

function gtag() {
  if (isLog) console.log('CONSENT: gtag() called', arguments);
  window.dataLayer.push(arguments);
}

function mapConsentToGtag(privacy) {
  const marketing   = !!privacy?.marketingAllowed;
  const analyticsOk = !!privacy?.analyticsProcessingAllowed;
  const preferences = !!privacy?.preferencesProcessingAllowed;
  return {
    ad_storage:              marketing   ? 'granted' : 'denied',
    ad_user_data:            marketing   ? 'granted' : 'denied',
    ad_personalization:      marketing   ? 'granted' : 'denied',
    analytics_storage:       analyticsOk ? 'granted' : 'denied',
    personalization_storage: preferences ? 'granted' : 'denied',
    functionality_storage:   'granted',
    security_storage:        'granted'
  };
}

let currentConsentState = null;

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

  const hardcodedDefault = {
    ad_storage:              'denied',
    ad_user_data:            'denied',
    ad_personalization:      'denied',
    analytics_storage:       'denied',
    personalization_storage: 'denied',
    functionality_storage:   'granted',
    security_storage:        'granted'
  };
  currentConsentState = hardcodedDefault;
  gtag('consent', 'default', Object.assign({}, hardcodedDefault, { wait_for_update: 500 }));
  if (isLog) console.log('CONSENT: default pushed ->', hardcodedDefault);

  if (initialPrivacy) {
    const knownConsent = mapConsentToGtag(initialPrivacy);
    currentConsentState = knownConsent;
    gtag('consent', 'update', knownConsent);
    if (isLog) console.log('CONSENT: initial update pushed ->', knownConsent);
  }

  const resolved = getCustomerPrivacyApi();
  if (!resolved) {
    if (isLog) console.warn('CONSENT: no customerPrivacy API found — staying on default.');
    return;
  }
  if (isLog) console.log('CONSENT: subscribed via', resolved.source);
  resolved.api.subscribe('visitorConsentCollected', function(event) {
    const updatedConsent = mapConsentToGtag(event?.customerPrivacy);
    currentConsentState = updatedConsent;
    gtag('consent', 'update', updatedConsent);
    if (isLog) console.log('CONSENT: update pushed ->', updatedConsent);
  });
}

function extractMarketData(event) {
  const marketData = event.data?.checkout?.localization?.market ?? event.data?.localization?.market ?? null;
  return {
    id:     marketData?.id?.split("/").pop() ?? null,
    handle: marketData?.handle ?? null
  };
}

// event_id: toza event.id barcha eventlar uchun.
// checkout_completed: "purchase_<orderId>" — stable, collision-safe.
function generateEventId(event, eventName) {
  if (eventName === 'checkout_completed') {
    const orderId = extractNumericId(event?.data?.checkout?.order?.id);
    if (orderId) return 'purchase_' + orderId;
    return 'purchase_' + (event?.data?.checkout?.token || event.id);
  }
  return event.id;
}

// =======================================================================
// dataLayer object builder
// =======================================================================

function prepareDataLayerObject(event, eventName) {
  if (isLog) console.log('event', event);

  const ecomm_pagetype = getPageType();
  const ecom           = parseEcomParams(event);
  ecom.items           = parseItems(event, data_layer);
  const user_data      = clearObj(parseUserData(event));
  const cart_state     = getCart(initContext?.data?.cart || {});
  const market         = extractMarketData(event);
  const event_id       = generateEventId(event, eventName);

  const rawUrl     = event?.context?.document?.location?.href || initContext?.context?.document?.location?.href || href;
  const actual_url = rawUrl.replace(/\]$/, '');

  const resolvedConsent                 = event?.consent || currentConsentState || {};
  const consent_ad_storage              = resolvedConsent.ad_storage              || null;
  const consent_ad_user_data            = resolvedConsent.ad_user_data            || null;
  const consent_ad_personalization      = resolvedConsent.ad_personalization      || null;
  const consent_analytics_storage       = resolvedConsent.analytics_storage       || null;
  const consent_personalization_storage = resolvedConsent.personalization_storage || null;

  let obj = {
    event:       event_name[eventName],
    event_id,
    user_data,
    cart_state,
    ecomm_pagetype,
    actual_url,
    consent_ad_storage,
    consent_ad_user_data,
    consent_ad_personalization,
    consent_analytics_storage,
    consent_personalization_storage
  };

  if (['checkout_completed', 'payment_info_submitted', 'checkout_started', 'checkout_shipping_info_submitted', 'checkout_contact_info_submitted'].includes(eventName)) {
    obj.checkout_token = event?.data?.checkout?.token;
  }

  if (eventName === 'checkout_completed' && obj.user_data) {
    obj.user_data.customer_lifetime_value = Number(
      ((Number(customerShopStape?.total_spent) || 0) + (Number(event?.data?.checkout?.totalPrice?.amount) || 0)).toFixed(2)
    );
  }

  if (['checkout_completed', 'payment_info_submitted', 'checkout_started', 'checkout_shipping_info_submitted', 'checkout_contact_info_submitted'].includes(eventName)) {
    obj.delivery = getDelivery(event);
  }

  if (['checkout_completed', 'payment_info_submitted'].includes(eventName)) {
    ecom.payment_type = event?.data?.checkout?.transactions?.[0]?.paymentMethod?.type;
  }

  if (['alert_displayed', 'ui_extension_errored'].includes(eventName)) {
    obj = Object.assign({}, obj, event?.data?.alert || {});
  }

  if (eventName !== 'page_viewed') obj.ecommerce = ecom;
  if (market.id)     obj.market_id     = market.id;
  if (market.handle) obj.market_handle = market.handle;

  return obj;
}

function handleAnalyticsEvent(event) {
  const eventName    = event.name;
  const isPageViewed = eventName === "page_viewed";
  const data         = prepareDataLayerObject(event, eventName);
  if (isLog) console.log('Send event data', data);

  setTimeout(function() {
    if (isCheckoutPage) {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(data);
    } else if (isPageViewed) {
      window.parent.postMessage(data, location.origin);
    }
  }, 500);
}

// =======================================================================
// SUBSCRIPTIONS
// =======================================================================

if (canSubscribe) {
  if (isCheckoutPage) {
    initConsentMode();
    if (!useMultyMarkets) {
      loadGTM();
    }
    analytics.subscribe("all_standard_events", function(event) {
      const marketId = event?.data?.checkout?.localization?.market?.id;
      if (useMultyMarkets && marketId) {
        loadGTM(marketId);
      }
      if (sandbox_events.includes(event.name) || event.name === 'page_viewed') {
        try { handleAnalyticsEvent(event); } catch(err) { console.error('handleAnalyticsEvent error:', err); }
      }
    });
  } else {
    analytics.subscribe("page_viewed", function(event) {
      try { handleAnalyticsEvent(event); } catch(err) { console.error('handleAnalyticsEvent error:', err); }
    });
  }
}

// =======================================================================
// HELPERS
// =======================================================================

function getPageType() {
  var path = initContext?.context?.document?.location?.pathname || '';
  if (path.includes('/collection'))                                   return 'category';
  if (path.includes('/product'))                                      return 'product';
  if (path.includes('/cart'))                                         return 'basket';
  if (path === '/')                                                   return 'home';
  if (path.includes('thank_you') || path.includes('thank-you'))      return 'purchase';
  if (path.includes('/checkout'))                                     return 'basket';
  return 'other';
}

// -----------------------------------------------------------------------
// loadGTM — Stape first-party subdomain loader
// Barcha market uchun container ID bir xil — switch kerak emas.
// useMultyMarkets = false bo'lganda key umuman berilmaydi.
// -----------------------------------------------------------------------
function injectGTM(containerId) {
  var GTM_LOADER_DOMAIN          = 'https://data.farruxbek.online';
  var GTM_LOADER_DOMAIN_FALLBACK = '';
  var CONTAINER_ID               = containerId;
  var QUERY_STRING               = '59wwwf=CAJQPzg6QEI1JStBVSQ9URdbX1ZdUQkZXAAMCh4CFRUEDUMXAhsEGQQ%3D';
  var UID_SOURCE                 = 'jsVariable';
  var UID_KEY                    = '_sbp';
  var UID_ATTRIBUTE              = '';

  var isSafariIOS16Plus = false;
  var uidValue;
  var isStapeUserId = false;

  function getCookieValue(name) {
    var cookies = document.cookie.split(';');
    for (var idx = 0; idx < cookies.length; idx++) {
      var pair = cookies[idx].split('=');
      if (pair[0].trim() === name) return pair[1];
    }
    return undefined;
  }

  function getLocalStorageValue(lsKey) {
    return localStorage.getItem(lsKey);
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
    if (typeof keys === 'undefined') keys = '';
    var resolvers = {
      cookie:       getCookieValue,
      localStorage: getLocalStorageValue,
      jsVariable:   getWindowValue,
      cssSelector:  getCssSelectorValue
    };
    var keyList = Array.isArray(keys) ? keys : [keys];
    if (source && resolvers[source]) {
      var resolver = resolvers[source];
      for (var k = 0; k < keyList.length; k++) {
        var resolved = attribute ? resolver(keyList[k], attribute) : resolver(keyList[k]);
        if (resolved) return resolved;
      }
    } else {
      console.warn('invalid uid source', source);
    }
    return undefined;
  }

  try {
    var uaMatch = new RegExp('Version/([0-9._]+)(.*Mobile)?.*Safari.*').exec(navigator.userAgent);
    isSafariIOS16Plus = !!UID_SOURCE && !!uaMatch && 16.4 <= parseFloat(uaMatch[1]);
    isStapeUserId     = 'stapeUserId' === UID_SOURCE;
    uidValue          = (isSafariIOS16Plus && !isStapeUserId) ? resolveUid(UID_SOURCE, UID_KEY, UID_ATTRIBUTE) : undefined;
    isSafariIOS16Plus = isSafariIOS16Plus && (!!uidValue || isStapeUserId);
  } catch (uidError) {
    console.error(uidError);
  }

  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });

  var firstScript = document.getElementsByTagName('script')[0];
  var uidParam    = uidValue ? '&bi=' + encodeURIComponent(uidValue) : '';
  var scriptTag   = document.createElement('script');

  var effectiveContainerId = CONTAINER_ID;
  if (isSafariIOS16Plus) {
    effectiveContainerId = CONTAINER_ID.length > 8 ?
      CONTAINER_ID.replace(/([a-z]{8}$)/, 'kp$1') :
      'kp' + CONTAINER_ID;
  }

  var baseUrl = (!isSafariIOS16Plus && GTM_LOADER_DOMAIN_FALLBACK) ?
    GTM_LOADER_DOMAIN_FALLBACK : GTM_LOADER_DOMAIN;

  scriptTag.async = true;
  scriptTag.src   = baseUrl + '/' + effectiveContainerId + '.js?' + QUERY_STRING + uidParam;

  if (firstScript && firstScript.parentNode) {
    firstScript.parentNode.insertBefore(scriptTag, firstScript);
  }
}

function loadGTM(key) {
  if (isInsertGTM) return;
  isInsertGTM = true;

  // Barcha marketlar uchun container ID bir xil.
  // Kelajakda har xil bo'lsa: switch (key) { case '...': injectGTM('other-id'); break; }
  injectGTM('3sibtwmwlxmfa');
}

// -----------------------------------------------------------------------
// parseItems — Stape production (fieldMapping, barcode, metafield,
// getLineItemDiscount, cacheAddedProductEnrichment)
// -----------------------------------------------------------------------
function parseItems(event, fieldMappingSetting) {
  var items = [];

  var fieldMappingEnabled = !!fieldMappingSetting?.field_mapping_enabled || !!fieldMappingSetting?.enabled || !!fieldMappingSetting?.item_id;
  var fieldMapping = fieldMappingSetting?.field_mapping || fieldMappingSetting || {};

  function normalizeDataPoints(dataPoints) {
    return (dataPoints || []).map(function(dp) {
      return typeof dp === 'string' ? { value: dp } : dp;
    });
  }

  function cleanShopifyId(value) {
    if (!value) return value;
    return String(value).split('/').pop();
  }

  function findShopStapeProductMatch(source) {
    var product = source?.product || {};
    var sourceProductId = cleanShopifyId(product.id || source?.product_id);
    if (!sourceProductId) return null;
    var sourceVariantId = cleanShopifyId(source?.id || source?.variant_id);

    var productShopStape = window?.productShopStape;
    if (productShopStape && cleanShopifyId(productShopStape.id) === sourceProductId) {
      var variant = (productShopStape.variants || []).find(function(item) {
        return cleanShopifyId(item?.id) === sourceVariantId;
      }) || null;
      return { product: productShopStape, variant: variant };
    }

    var collectionProduct = (window?.collectionShopStape?.products || []).find(function(item) {
      return cleanShopifyId(item?.id) === sourceProductId;
    });
    if (collectionProduct) {
      var colVariant = (collectionProduct.variants || []).find(function(item) {
        return cleanShopifyId(item?.id) === sourceVariantId;
      }) || null;
      return { product: collectionProduct, variant: colVariant };
    }
    return null;
  }

  var FIELD_MAPPING_CACHE_KEY   = 'fieldMappingProductStape';
  var FIELD_MAPPING_CACHE_LIMIT = 50;
  var MARKET_CACHE_KEY          = 'marketShopStape';

  function readFieldMappingCache() {
    try { return JSON.parse(localStorage.getItem(FIELD_MAPPING_CACHE_KEY)) || {}; }
    catch (e) { return {}; }
  }

  function cacheAddedProductEnrichment(source) {
    var match     = findShopStapeProductMatch(source);
    var product   = match?.product;
    var variant   = match?.variant;
    var productId = cleanShopifyId(product?.id);
    var variantId = cleanShopifyId(variant?.id || source?.id || source?.variant_id);
    if (!productId) return;
    var hasProductData = product.category || product.collections || product.metafields;
    var hasVariantData = variantId && variant?.barcode;
    if (!hasProductData && !hasVariantData) return;
    try {
      var cache    = readFieldMappingCache();
      var existing = cache[productId] || {};
      cache[productId] = {
        category:    product.category    || existing.category    || null,
        collections: product.collections || existing.collections || null,
        metafields:  product.metafields  || existing.metafields  || null,
        variants: variantId ? Object.assign({}, existing.variants, { [variantId]: { barcode: variant?.barcode || (existing.variants && existing.variants[variantId] && existing.variants[variantId].barcode) || null } }) : existing.variants
      };
      var keys = Object.keys(cache);
      if (keys.length > FIELD_MAPPING_CACHE_LIMIT) delete cache[keys[0]];
      localStorage.setItem(FIELD_MAPPING_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {}
  }

  function getEnrichedProduct(source) {
    var match = findShopStapeProductMatch(source);
    if (match?.product) return match.product;
    var product   = source?.product || {};
    var productId = cleanShopifyId(product.id || source?.product_id);
    return productId ? readFieldMappingCache()[productId] || null : null;
  }

  function getEnrichedVariant(source) {
    var match = findShopStapeProductMatch(source);
    if (match?.variant) return match.variant;
    var product   = source?.product || {};
    var productId = cleanShopifyId(product.id || source?.product_id);
    var variantId = cleanShopifyId(source?.id || source?.variant_id);
    if (!productId || !variantId) return null;
    return (readFieldMappingCache()[productId]?.variants && readFieldMappingCache()[productId].variants[variantId]) || null;
  }

  function readMarketCache() {
    try { return JSON.parse(localStorage.getItem(MARKET_CACHE_KEY)) || {}; }
    catch (e) { return {}; }
  }

  function getMetafieldValue(source, metafieldName) {
    if (!source || !metafieldName) return null;
    var parts     = String(metafieldName).split('.');
    var namespace = parts[0];
    var key       = parts[1];
    var match     = findShopStapeProductMatch(source);
    var metafields = source?.metafields || source?.product?.metafields || match?.variant?.metafields || match?.product?.metafields || getEnrichedProduct(source)?.metafields || [];
    if (Array.isArray(metafields)) {
      var mf = metafields.find(function(item) { return item?.namespace === namespace && item?.key === key; });
      return mf?.value || null;
    }
    if (namespace && key) return metafields?.[namespace]?.[key]?.value || metafields?.[namespace]?.[key] || null;
    return metafields?.[metafieldName] || null;
  }

  function getMappedDataPointValue(dataPoint, source) {
    var product = source?.product || {};
    if (dataPoint.value === 'country_market_code') return window?.Shopify?.country || window?.currentShopifyMarketStapeCode || readMarketCache()?.code || '';
    if (dataPoint.value === 'product_id')  return cleanShopifyId(product.id || source?.product_id);
    if (dataPoint.value === 'variant_id')  return cleanShopifyId(source?.id || source?.variant_id);
    if (dataPoint.value === 'sku')         return source?.sku;
    if (dataPoint.value === 'barcode')     return source?.barcode || findShopStapeProductMatch(source)?.variant?.barcode || getEnrichedVariant(source)?.barcode;
    if (dataPoint.value === 'metafield')   return getMetafieldValue(source, dataPoint.metafield_name);
    return null;
  }

  function buildMappedValue(source, mapping) {
    var dataPoints     = normalizeDataPoints(mapping?.data_points || []);
    var separator      = mapping?.separator || '';
    var prefix         = mapping?.prefix    || '';
    var resolvedValues = dataPoints.map(function(dp) { return getMappedDataPointValue(dp, source); }).filter(Boolean);
    if (!resolvedValues.length) return '';
    return prefix + resolvedValues.join(separator);
  }

  function getMappedSourceValue(source, mapping, defaultValue) {
    var product = source?.product || {};
    if (!mapping?.source) return defaultValue;
    if (mapping.source === 'vendor')       return product.vendor;
    if (mapping.source === 'product_type') return product.type;
    if (mapping.source === 'product_category') {
      var category = product.category || product.productCategory || product.standardProductCategory || getEnrichedProduct(source)?.category;
      return (typeof category === 'object' ? category?.name || category?.full_name : category) || null;
    }
    if (mapping.source === 'collection') {
      var shopStapeCollections = getEnrichedProduct(source)?.collections;
      return product.collection || product.collections?.[0]?.title || product.collections?.[0] || shopStapeCollections?.[0]?.title || shopStapeCollections?.[0];
    }
    if (mapping.source === 'metafield') return getMetafieldValue(source, mapping.metafield_name);
    return defaultValue;
  }

  function applyFieldMapping(item, source) {
    if (!fieldMappingEnabled) return item;
    var mappedItemId  = buildMappedValue(source, fieldMapping.item_id);
    var mappedItemSku = buildMappedValue(source, fieldMapping.item_sku);
    return Object.assign({}, item, {
      item_id:       mappedItemId  || item.item_id,
      item_sku:      mappedItemSku || item.item_sku,
      item_brand:    getMappedSourceValue(source, fieldMapping.item_brand,    item.item_brand)    || item.item_brand,
      item_category: getMappedSourceValue(source, fieldMapping.item_category, item.item_category) || item.item_category
    });
  }

  function getLineItemDiscount(lineItem) {
    var allocatedDiscount = (lineItem.discountAllocations || []).reduce(function(sum, allocation) {
      return sum + (Number(allocation?.amount?.amount) || 0);
    }, 0);
    if (allocatedDiscount > 0) return allocatedDiscount;
    var undiscountedTotal = Number(lineItem.variant?.price?.amount || 0) * lineItem.quantity;
    var finalLinePrice    = Number(lineItem.finalLinePrice?.amount);
    var impliedDiscount   = Number.isFinite(finalLinePrice) ? undiscountedTotal - finalLinePrice : 0;
    return impliedDiscount > 0 ? impliedDiscount : null;
  }

  if (event.data?.checkout?.lineItems) {
    for (var i = 0; i < event.data.checkout.lineItems.length; i++) {
      var lineItem = event.data.checkout.lineItems[i];
      var sellingPlanAllocation = lineItem.sellingPlanAllocation;
      var item = {
        item_id:       lineItem.variant.product.id,
        item_sku:      lineItem.variant.sku,
        item_variant:  lineItem.variant.id,
        item_name:     lineItem.variant.product.title,
        variant_name:  lineItem.variant.title,
        item_category: lineItem.variant.product.type,
        item_brand:    lineItem.variant.product.vendor,
        item_url:      lineItem.variant.product?.url,
        price:         lineItem.variant.price.amount,
        imageURL:      lineItem?.variant?.image?.src,
        discount:      getLineItemDiscount(lineItem),
        quantity:      lineItem.quantity,
        index:         i + 1
      };
      if (sellingPlanAllocation && sellingPlanAllocation.sellingPlan?.id) {
        var spId   = sellingPlanAllocation.sellingPlan.id.split('/').pop();
        var spName = sellingPlanAllocation.sellingPlan.name || null;
        if (spId)   item.item_selling_plan_id   = spId;
        if (spName) item.item_selling_plan_name = spName;
      }
      items.push(applyFieldMapping(item, lineItem.variant));
    }
  }

  if (event.data?.cartLine?.merchandise) {
    var merchandise = event.data.cartLine.merchandise;
    if (event.name === 'product_added_to_cart') {
      cacheAddedProductEnrichment(merchandise);
    }
    items.push(applyFieldMapping({
      item_id:       merchandise.product.id,
      item_sku:      merchandise.sku,
      item_variant:  merchandise.id,
      item_name:     merchandise.product.title,
      variant_name:  merchandise.title,
      item_category: merchandise.product.type,
      item_brand:    merchandise.product.vendor,
      item_url:      merchandise.product?.url,
      price:         merchandise.price.amount,
      imageURL:      merchandise?.image?.src,
      quantity:      event.data.cartLine.quantity
    }, merchandise));
  }

  if (event.data?.productVariant) {
    items.push(applyFieldMapping({
      item_id:       event.data.productVariant.product.id,
      item_sku:      event.data.productVariant.sku,
      item_variant:  event.data.productVariant.id,
      item_name:     event.data.productVariant.product.title,
      variant_name:  event.data.productVariant.title,
      item_category: event.data.productVariant.product.type,
      price:         event.data.productVariant.price.amount,
      item_brand:    event.data.productVariant.product.vendor,
      imageURL:      event.data.productVariant?.image?.src,
      item_url:      event.data.productVariant?.product?.url,
      quantity:      '1'
    }, event.data.productVariant));
  }

  if (event.data?.collection?.productVariants) {
    for (var ci = 0; ci < event.data.collection.productVariants.length; ci++) {
      var cv = event.data.collection.productVariants[ci];
      items.push(applyFieldMapping({
        item_id: cv.product.id, item_sku: cv.sku, item_variant: cv.id,
        item_name: cv.product.title, variant_name: cv.title,
        item_category: cv.product.type, item_brand: cv.product.vendor,
        price: cv.price.amount, imageURL: cv?.image?.src, item_url: cv?.product?.url, index: ci + 1
      }, cv));
    }
  }

  if (event.data?.searchResult?.productVariants) {
    for (var si = 0; si < event.data.searchResult.productVariants.length; si++) {
      var sv = event.data.searchResult.productVariants[si];
      items.push(applyFieldMapping({
        item_id: sv.product.id, item_sku: sv.sku, item_variant: sv.id,
        item_name: sv.product.title, variant_name: sv.title,
        item_category: sv.product.type, item_brand: sv.product.vendor,
        price: sv.price.amount, imageURL: sv?.image?.src, item_url: sv?.product?.url, index: si + 1
      }, sv));
    }
  }

  if (event.data?.cart?.lines) {
    for (var li = 0; li < event.data.cart.lines.length; li++) {
      var line = event.data.cart.lines[li];
      items.push(applyFieldMapping({
        item_id: line.merchandise.product.id, item_sku: line.merchandise.sku,
        item_variant: line.merchandise.id, item_name: line.merchandise.product.title,
        variant_name: line.merchandise.title, item_category: line.merchandise.product.type,
        item_brand: line.merchandise.product.vendor, item_url: line.merchandise?.product?.url,
        price: line.merchandise.price.amount, imageURL: line.merchandise?.image?.src,
        quantity: line.quantity, index: li + 1
      }, line.merchandise));
    }
  }

  try {
    if (window?.productShopStape?.variants) {
      window.productShopStape.variants.forEach(function(variant) {
        for (var idx = 0; idx < items.length; idx++) {
          if (variant?.id == items[idx]?.item_variant && variant?.compare_at_price) {
            items[idx].compare_at_price = (variant.compare_at_price / 100) + '';
          }
        }
      });
    }
    if (window?.collectionShopStape?.products) {
      window.collectionShopStape.products.forEach(function(product) {
        (product?.variants || []).forEach(function(variant) {
          for (var idx = 0; idx < items.length; idx++) {
            if (variant?.id == items[idx]?.item_variant && variant?.compare_at_price) {
              items[idx].compare_at_price = variant.compare_at_price + '';
            }
          }
        });
      });
    }
    if (localStorage?.getItem('addedProductStape')) {
      var addedProductStape = [];
      try { addedProductStape = JSON.parse(localStorage.getItem('addedProductStape')) || []; } catch (e) {}
      addedProductStape.forEach(function(_i) {
        for (var idx = 0; idx < items.length; idx++) {
          if (_i?.item_variant == items[idx]?.item_variant && _i.compare_at_price) {
            items[idx].compare_at_price = _i.compare_at_price + '';
          }
        }
      });
    }
  } catch (e) {}

  return items;
}

// -----------------------------------------------------------------------
// parseEcomParams
// -----------------------------------------------------------------------
function parseEcomParams(event) {
  var ecom = {};

  if (event?.data?.checkout?.totalPrice?.hasOwnProperty('amount')) {
    ecom.value         = event?.data?.checkout?.totalPrice?.amount?.toString();
    ecom.cart_total    = event?.data?.checkout?.totalPrice?.amount?.toString();
    ecom.currency      = event?.data?.checkout?.totalPrice?.currencyCode;
    ecom.cart_quantity = (event?.data?.checkout?.lineItems || []).reduce(function(sum, li) {
      return sum + (Number(li?.quantity) || 0);
    }, 0);
  }

if (event.name === "checkout_completed") {
  ecom.tax                 = event?.data?.checkout?.totalTax?.amount;
  ecom.shipping            = event?.data?.checkout?.shippingLine?.price?.amount;

  // TOʻGʻRILANDI: GID'dan faqat raqamni ajratib olish va Fallback (zaxira) qo'shish
  const rawOrderId         = event?.data?.checkout?.order?.id;
  const orderName          = event?.data?.checkout?.order?.name;
  const checkoutToken      = event?.data?.checkout?.token;

  ecom.transaction_id      = extractNumericId(rawOrderId) || orderName || checkoutToken || null;
    var discountApplications = event?.data?.checkout?.discountApplications || [];
    var discountTitles       = discountApplications.map(function(d) { return d?.title; }).filter(Boolean);
    var discountAmountTotal  = discountApplications.reduce(function(sum, d) {
      var amt = Number(d?.value?.amount);
      return sum + (isNaN(amt) ? 0 : amt);
    }, 0);
    var discountPercentages  = discountApplications.map(function(d) { return d?.value?.percentage; }).filter(function(p) { return p !== undefined && p !== null; });
    ecom.coupon              = discountTitles.length ? discountTitles.join(', ') : null;
    ecom.discount            = discountTitles.length ? discountTitles.join(', ') : null;
    ecom.discount_amount     = discountApplications.length ? discountAmountTotal.toFixed(2) : null;
    ecom.discount_percentage = discountPercentages.length ? discountPercentages.join(', ') : null;
    ecom.sub_total           = event?.data?.checkout?.subtotalPrice?.amount;
  }

  if (event.name === "collection_viewed") {
    ecom.collection_id  = event?.data?.collection?.id + '';
    ecom.item_list_id   = event?.data?.collection?.id + '';
    ecom.item_list_name = event?.data?.collection?.title;
    ecom.currency       = event?.data?.collection?.productVariants[0]?.price?.currencyCode;
  }

  if (event.name === "search_submitted") {
    ecom.search_term = event?.data?.searchResult?.query;
    ecom.currency    = event?.data?.searchResult?.productVariants[0]?.price?.currencyCode;
  }

  if (event.name === "cart_viewed") {
    ecom.value    = event?.data?.cart?.cost?.totalAmount?.amount?.toString();
    ecom.currency = event?.data?.cart?.cost?.totalAmount?.currencyCode;
  }

  if (event.name === "product_viewed") {
    ecom.value    = event?.data?.productVariant?.price?.amount?.toString();
    ecom.currency = event?.data?.productVariant?.price?.currencyCode;
  }

  if (event.name === "product_added_to_cart") {
    ecom.value    = (event?.data?.cartLine?.cost?.totalAmount?.amount * 1).toFixed(2);
    ecom.currency = event?.data?.cartLine?.cost?.totalAmount?.currencyCode;
  }

  if (event.name === "product_removed_from_cart") {
    ecom.value    = (event?.data?.cartLine?.cost?.totalAmount?.amount * 1).toFixed(2);
    ecom.currency = event?.data?.cartLine?.cost?.totalAmount?.currencyCode;
  }

  return ecom;
}

// -----------------------------------------------------------------------
// getCart
// -----------------------------------------------------------------------
function getCart(cart) {
  cart = cart || {};
  return {
    cart_id:       cart.id || null,
    cart_quantity: cart.totalQuantity || 0,
    cart_value:    cart.cost?.totalAmount?.amount || 0,
    currency:      cart.cost?.totalAmount?.currencyCode,
    lines: (cart.lines || []).map(function(_i) {
      return {
        item_variant:     _i.merchandise.id,
        item_id:          _i.merchandise.product.id,
        item_sku:         _i.merchandise.sku,
        item_name:        _i.merchandise.product.title,
        quantity:         _i.quantity,
        line_total_price: _i.cost.totalAmount.amount,
        price:            _i.merchandise.price.amount
      };
    })
  };
}

// -----------------------------------------------------------------------
// getDelivery
// -----------------------------------------------------------------------
function getDelivery(event) {
  var data = {};
  var shippingAmount     = event?.data?.checkout?.delivery?.selectedDeliveryOptions[0]?.cost?.amount || 0;
  var costAfterDiscounts = event?.data?.checkout?.delivery?.selectedDeliveryOptions[0]?.costAfterDiscounts?.amount || 0;
  data.shipping_tier           = event?.data?.checkout?.delivery?.selectedDeliveryOptions[0]?.title || '';
  data.shipping_amount         = shippingAmount;
  data.currency                = event?.data?.checkout?.delivery?.selectedDeliveryOptions[0]?.cost?.currencyCode;
  data.address_province_code   = event?.data?.checkout?.shippingAddress?.provinceCode || null;
  data.address_zip             = event?.data?.checkout?.shippingAddress?.zip || null;
  data.delivery_method_type    = event?.data?.checkout?.delivery?.selectedDeliveryOptions[0]?.type || "shipping";
  data.shipping_discount_amount = shippingAmount - costAfterDiscounts;
  return data;
}

// -----------------------------------------------------------------------
// parseUserData
// -----------------------------------------------------------------------
function parseUserData(event) {
  var userData = {};
  userData.first_name        = event.data?.checkout?.billingAddress?.firstName  || event.data?.checkout?.shippingAddress?.firstName  || initContext?.data?.customer?.firstName  || null;
  userData.last_name         = event.data?.checkout?.billingAddress?.lastName   || event.data?.checkout?.shippingAddress?.lastName   || initContext?.data?.customer?.lastName   || null;
  userData.email             = event.data?.checkout?.email                      || initContext?.data?.customer?.email                 || null;
  userData.phone             = event.data?.checkout?.billingAddress?.phone      || event.data?.checkout?.shippingAddress?.phone      || initContext?.data?.customer?.phone      || null;
  userData.city              = event.data?.checkout?.billingAddress?.city       || event.data?.checkout?.shippingAddress?.city       || null;
  userData.country           = event.data?.checkout?.billingAddress?.countryCode || event.data?.checkout?.shippingAddress?.countryCode || null;
  userData.zip               = event.data?.checkout?.billingAddress?.zip        || event.data?.checkout?.shippingAddress?.zip        || null;
  userData.region            = event.data?.checkout?.billingAddress?.provinceCode || event.data?.checkout?.shippingAddress?.provinceCode || null;
  userData.street            = event.data?.checkout?.billingAddress?.address1   || event.data?.checkout?.shippingAddress?.address1   || null;
  userData.customer_id       = initContext?.data?.customer?.id || event?.data?.checkout?.order?.customer?.id || null;
  userData.new_customer      = event?.data?.checkout?.order?.customer?.isFirstOrder;
  userData.shopify_client_id = event?.clientId;
  return userData;
}
