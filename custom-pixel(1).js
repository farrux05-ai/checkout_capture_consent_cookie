/**
 * ============================================================================
 * CUSTOM PIXEL — Checkout Events → Stape GTM (first-party subdomain)
 * ============================================================================
 *
 * NIMA O'ZGARDI VA NEGA:
 *
 * 1) Stape App'ning umumiy CDN'idan (sp.stapecdn.com) skript fetch() qilish
 *    butunlay OLIB TASHLANDI. Bu domen barcha Stape mijozlari uchun umumiy
 *    bo'lgani sababli EasyList/EasyPrivacy kabi adblock ro'yxatlarida tez-tez
 *    bloklanadi — bloklansa, .then() ichidagi subscribe ham ishga tushmay
 *    qoladi va hech narsa yozilmaydi. Buning o'rniga faqat sizning shaxsiy
 *    (first-party) subdomeningiz — data.farruxbek.online — orqali GTM
 *    konteynerini yuklovchi loadGTM() qoldirildi. Bu ancha bloklarga chidamli,
 *    chunki u faqat sizning do'koningizga tegishli, umumiy signature'ga ega
 *    emas.
 *
 * 2) event_id endi shu yerning O'ZIDA, bitta joyda generatsiya qilinadi va
 *    dataLayer obyektiga bir marta yoziladi (generateEventId funksiyasi).
 *    Bitta dataLayer.push() natijasida GTM konteyneridagi HAM pixel tag
 *    (Facebook/TikTok Pixel by Stape), HAM server Data Tag bir xil
 *    dataLayer'dan o'qiydi — shuning uchun ikkalasi ham AYNAN bir xil
 *    event_id bilan ketadi. Avval Stape'ning o'zi avtomatik generatsiya
 *    qilganda hybrid rejimda ikki tomon uchun ikki xil ID yasalgani sababli
 *    dedup ishlamayotgan edi — bu endi tuzatildi.
 *
 * 3) checkout_completed (purchase) uchun event_id ORDER ID asosida BARQAROR
 *    qilib yasaladi (tasodifiy emas). Sabab: thank-you sahifasi qayta
 *    yuklansa (F5, orqaga/oldinga tugmasi), checkout_completed yana otilishi
 *    mumkin. Agar shu holatda tasodifiy ID ishlatilsa, Meta/TikTok/GA4 buni
 *    IKKINCHI xarid deb hisoblab, ROAS/sotuvlar raqamini shishirib yuboradi.
 *    Order ID hech qachon o'zgarmagani uchun, qayta otilgan event ham xuddi
 *    shu event_id bilan ketadi va reklama tizimlari uni avtomatik ravishda
 *    "allaqachon ko'rilgan" deb tashlab yuboradi (dedup) — ya'ni bitta order
 *    = bitta konversiya, necha marta sahifa yuklansa ham.
 *
 * 4) Qolgan barcha eventlar (add_payment_info, begin_checkout va h.k.) uchun
 *    Shopify'ning o'zi har bir chaqiruv uchun kafolatlab beradigan event.id
 *    ishlatiladi (Shopify Web Pixels API'da har bir event.id — shu bitta
 *    dispatch uchun unique). Bizga alohida crypto.randomUUID() yasashning
 *    hojati yo'q — muhimi shuki, bu qiymat FAQAT shu yerda bir marta o'qiladi
 *    va bitta dataLayer obyektiga yoziladi, ikki marta emas.
 *
 * ----------------------------------------------------------------------------
 * GTM TOMONIDA QILISHINGIZ KERAK BO'LGAN ISHLAR (bu kod ishlashi uchun):
 *
 *   a) GTM'da yangi "Data Layer Variable" yarating: nomi masalan
 *      "DLV - event_id", Data Layer Variable Name maydoniga: event_id
 *
 *   b) Quyidagi TAG'larning har birida "Event ID" (yoki "event_id") maydoniga
 *      shu {{DLV - event_id}} o'zgaruvchisini biriktiring:
 *         - [Stape] Meta - AddPaymentInfo / AddToCart / InitiateCheckout /
 *           PageView / Purchase / Search / ViewContent
 *         - [Stape] TikTok - (xuddi shu ro'yxat)
 *         - [Stape] DT - * (Data Tag'lar — bular Stape Client orqali server
 *           konteynerga event_id'ni ham olib o'tadi, u yerda Meta CAPI /
 *           TikTok Events API tag'lari ham shu event_id'ni o'qishi kerak)
 *
 *   c) Har bir shu tag ichida "Auto-generate Event ID" yoki shunga o'xshash
 *      avtomatik ID generatsiya toggle'i bor bo'lsa — uni O'CHIRING. Aks
 *      holda Stape yana o'zicha qo'shimcha ID yasab, bizning aniq
 *      event_id'imiz ustidan yozib yuborishi yoki unga qo'shimcha bo'lib
 *      qolishi mumkin.
 *
 *   d) Shopify Admin → Settings → Customer events bo'limini oching va agar
 *      u yerda Stape App tomonidan avtomatik o'rnatilgan alohida "Web Pixel"
 *      (aynan o'sha fetch(sp.stapecdn.com...) kodi) faol turgan bo'lsa —
 *      uni O'CHIRING yoki OLIB TASHLANG. Aks holda ikkita pixel bir vaqtda
 *      ishlaydi, GTM konteyneri ikki marta yuklanadi va har bir event ikki
 *      baravar (duplicate) bo'lib ketadi.
 * ============================================================================
 */

// Shopify Custom Pixel muharriri `analytics`, `browser`, `init` obyektlarini
// tayyor holda taqdim etadi (register() shart emas) — shuning uchun ularni
// bevosita ishlatamiz, window orqali emas. Bu, jumladan, Shopify'ning o'z
// statik tekshiruvchisi "analytics.subscribe(...)" chaqiruvini aniqroq
// tanib olishiga yordam beradi (rasmiy misollarda ham shunday yoziladi).
const initContext = init;

const GTM_ID = '5TCF99SP'; // Settings tag'dan
const GTM_URL = 'https://data.farruxbek.online'; // First-party (custom) subdomen

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
// QISM 1 — CONSENT MODE
// =======================================================================
// Shopify Customer Privacy -> Google Consent Mode.
//
// Checkout'da Cookiebot (yoki boshqa tashqi CMP) UMUMAN ishlamaydi —
// Shopify checkout'da uchinchi tomon skriptlariga ruxsat bermaydi. Shuning
// uchun bu yerda consent manbai FAQAT Shopify'ning o'z native Customer
// Privacy API'si:
//   - initContext.customerPrivacy      -> boshlang'ich (default) holat
//   - customerPrivacy.subscribe(...)   -> keyingi o'zgarishlar
// Bu Shopify Admin -> Settings -> Customer Privacy sozlamalariga bog'liq,
// Cookiebot sozlamalariga EMAS — ikkalasi mos kelishini alohida tekshiring
// (Cookiebot -> Settings -> Shopify integration yoqilganmi).
//
// TEKSHIRISH (bu qismni qo'shgandan keyin, checkout'da konsolni oching):
//   1. "CONSENT: initial privacy snapshot" logini toping — customerPrivacy
//      obyekti kelayotganini tasdiqlaydi (undefined bo'lsa — muammo shu
//      yerda, keyingi qadamga o'tmang).
//   2. "CONSENT: gtag default pushed" logini toping — qaysi qiymatlar
//      (granted/denied) yuborilganini ko'rasiz.
//   3. Checkout'da consent banner ko'rsatilsa va tanlov qilsangiz —
//      "CONSENT: gtag update pushed" logi chiqishi kerak.

window.dataLayer = window.dataLayer || [];

// gtag() shim — GTM'ning o'z ichki Consent Mode protokoliga mos formatda
// dataLayer'ga "consent" buyrug'ini yozadi. Bu window.dataLayer.push(obj)
// bilan bir xil massivga yoziladi, lekin GTM buni maxsus (arguments-style)
// formatda tanib, o'zining native consent mexanizmini ishga tushiradi.
function gtag() {
  if (isLog) console.log('CONSENT: gtag() chaqirildi', arguments);
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
    // Bular odatda har doim "granted" — saytning texnik ishlashi va
    // xavfsizligi uchun zarur, consent'ga bog'liq emas.
    functionality_storage: 'granted',
    security_storage: 'granted'
  };
}

// Server tomonida aniq filtr qo'yish uchun (GTM'ning "ko'rinmas" ichki
// holatiga ishonib o'tirmasdan), so'nggi ma'lum consent holatini shu
// yerda saqlab boramiz — har bir event payload'iga ANIQ MAYDON sifatida
// qo'shib yuboramiz (pastda, prepareDataLayerObject ichida).
let currentConsentState = null;

function initConsentMode() {
  const initialPrivacy = initContext?.customerPrivacy;
  if (isLog) console.log('CONSENT: boshlang\'ich privacy snapshot', initialPrivacy);

  // 1) Boshlang'ich holatni GTM konteyner yuklanishidan OLDIN joylashtiramiz.
  //    Bu SHART — aks holda GTM yuklangan zahoti ishga tushadigan tag'lar
  //    (masalan GA4 config) consent holatisiz otilib ketishi mumkin.
  const defaultConsent = mapConsentToGtag(initialPrivacy);
  currentConsentState = defaultConsent;
  gtag('consent', 'default', Object.assign({}, defaultConsent, { wait_for_update: 500 }));
  if (isLog) console.log('CONSENT: default yuborildi ->', defaultConsent);

  // 2) Consent keyinchalik o'zgarsa (checkout'da ham banner ko'rsatilishi
  //    mumkin bo'lgan hududlarda) — yangilanishni GTM'ga yetkazamiz VA
  //    saqlab qo'yamiz, keyingi eventlar shu yangilangan holatni olsin.
  if (typeof customerPrivacy === 'undefined' || !customerPrivacy?.subscribe) {
    if (isLog) console.warn('CONSENT: customerPrivacy.subscribe topilmadi — faqat default bilan qolamiz');
    return;
  }

  customerPrivacy.subscribe('visitorConsentCollected', (event) => {
    const updatedConsent = mapConsentToGtag(event?.customerPrivacy);
    currentConsentState = updatedConsent;
    gtag('consent', 'update', updatedConsent);
    if (isLog) console.log('CONSENT: update yuborildi ->', updatedConsent, 'raw:', event?.customerPrivacy);
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
 * event_id generatori — bitta yagona manba (single source of truth).
 * Bu funksiya natijasi to'g'ridan-to'g'ri dataLayer obyektiga yoziladi va
 * GTM'dagi barcha tag'lar (pixel ham, server Data Tag ham) shu bitta
 * qiymatni o'qiydi.
 */
function generateEventId(event, eventName) {
  if (eventName === 'checkout_completed') {
    // Purchase — order.id asosida BARQAROR id. Sahifa qayta yuklansa ham
    // xuddi shu id qaytadi -> reklama tizimlari dedup qilib, sotuvni
    // ikki marta hisoblamaydi.
    const orderId = extractNumericId(event?.data?.checkout?.order?.id);
    if (orderId) return 'purchase_' + orderId;
    // order.id hali kelmagan juda kam holat uchun zaxira variant:
    return 'purchase_' + (event?.data?.checkout?.token || event.id);
  }

  // Qolgan barcha eventlar — Shopify'ning o'zi har bir dispatch uchun
  // kafolatlaydigan event.id'dan foydalanamiz.
  return eventName + '_' + event.id;
}

// =======================================================================
// QISM 2 — MARKETING COOKIE'LARNI O'QISH (fbc, fbp, gclid, ttp)
// =======================================================================
// Checkout sandbox'da document.cookie ISHLAMAYDI — u undefined qaytaradi
// (bu Shopify'ning o'z rasmiy hujjatida tasdiqlangan). O'rniga Shopify
// ASINXRON, sanktsiyalangan API beradi: browser.cookie.get(name) ->
// Promise<string>. Bu HAQIQIY top-frame cookie jar'iga (proksi orqali)
// chiqadi — ya'ni bu yerdagi qiymat HAQIQIY, sandbox'ning o'z ichki
// (izolyatsiya qilingan) cookie'si emas.
//
// _gcl_aw formati: "GCL.<vaqt>.<gclid>" — gclid'ni olish uchun nuqta (.)
// bo'yicha bo'lib, ENG OXIRGI qismini olamiz.
//
// TEKSHIRISH: checkout'da konsolda "COOKIE: o'qilgan qiymatlar ->" logini
// qidiring. Agar fbc/fbp/gclid barchasi `null` chiqsa — bu ODDIY holat
// bo'lishi mumkin (mijoz reklama orqali kelmagan bo'lsa, bu cookie'lar
// umuman mavjud emas) — xato emas. Xavotir faqat shundaki, agar siz BILA
// TURIB reklama linkidan sinov o'tkazgan bo'lsangiz-u, baribir `null`
// chiqsa.

async function safeGetCookie(name) {
  try {
    const value = await browser.cookie.get(name);
    return value || null;
  } catch (err) {
    if (isLog) console.warn('COOKIE: "' + name + '" o\'qilmadi ->', err);
    return null;
  }
}

// "GCL.<vaqt>.<qiymat>" formatidan qiymatni ajratib olish. Oxirgi
// bo'lakni emas, IKKINCHI nuqtadan keyingi HAMMA qismini olamiz — chunki
// gclid/gbraid'ning o'zi nazariy jihatdan nuqta belgisini o'z ichiga
// olishi mumkin, oxirgi bo'lakni olish bu holda uni qirqib tashlaydi.
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
    if (isLog) console.warn('COOKIE: browser.cookie mavjud emas — bo\'sh qiymatlar bilan davom etamiz');
    return { fbc: null, fbp: null, gclid: null, gcl_aw_raw: null, gbraid: null, gcl_gb_raw: null, ttp: null };
  }

  // Barcha cookie'larni PARALLEL o'qiymiz (Promise.all) — ketma-ket
  // o'qisak, har birining kutish vaqti qo'shilib, umumiy kechikish oshadi.
  const [fbc, fbp, gclAw, gclGb, ttp] = await Promise.all([
    safeGetCookie('_fbc'),
    safeGetCookie('_fbp'),
    safeGetCookie('_gcl_aw'),   // gclid shu yerda
    safeGetCookie('_gcl_gb'),   // gbraid shu yerda (iOS/app kampaniyalari)
    safeGetCookie('_ttp')
  ]);

  const gclid = extractAfterSecondDot(gclAw);
  const gbraid = extractAfterSecondDot(gclGb);
  const result = {
    fbc, fbp, ttp,
    gclid, gcl_aw_raw: gclAw,
    gbraid, gcl_gb_raw: gclGb
  };

  if (isLog) console.log('COOKIE: o\'qilgan qiymatlar ->', result);
  return result;
}

// wbraid uchun aniq, keng tarqalgan cookie nomi topilmadi (past ishonch) —
// shuning uchun buni faqat URL'dan o'qiymiz. UTM parametrlari ham xuddi
// shunday: standart cookie yo'q, faqat checkout URL'ida saqlanib qolgan
// bo'lsa o'qiladi. KO'P HOLLARDA BULAR `null` BO'LISHI KUTILGAN — checkout
// paytiga kelib bu parametrlar odatda URL'dan yo'qolgan bo'ladi (agar
// tema o'zi maxsus saqlamasa). Xato emas, faqat cheklov.
function getUrlBasedSignals(url) {
  let params;
  try {
    params = new URL(url).searchParams;
  } catch (err) {
    if (isLog) console.warn('URL: parse qilinmadi ->', url, err);
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

  if (isLog) console.log('URL: signallar ->', result);
  return result;
}

// =======================================================================
// ATTRIBUTION (UTM + Click-ID) PERSISTENCE — browser.localStorage
// =======================================================================
// Storefront'da UTM/click-ID URL'da bo'ladi, lekin checkout URL'ida
// yo'qoladi. Shu sababli localStorage ga saqlab, checkout'da tiklaymiz.
// 30 daqiqa TTL — reklama attribusiyasi uchun standart.

const ATTR_KEY = 'shopify_pixel_attr_v1';
const ATTR_TTL_MS = 30 * 60 * 1000; // 30 daqiqa

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
    const merged = { ...stored };
    for (const [key, value] of Object.entries(fresh)) {
      if (value !== null && value !== undefined && value !== '') {
        merged[key] = value;
      }
    }
    merged.saved_at = Date.now();
    await browser.localStorage.setItem(ATTR_KEY, JSON.stringify(merged));
    if (isLog) console.log('ATTR: saqlandi ->', merged);
  } catch (err) {
    if (isLog) console.warn('ATTR: saqlashda xato ->', err);
  }
}

async function getAttribution() {
  try {
    const raw = await browser.localStorage.getItem(ATTR_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (Date.now() - (parsed.saved_at || 0) > ATTR_TTL_MS) {
      await browser.localStorage.removeItem(ATTR_KEY);
      if (isLog) console.log('ATTR: 30 daqiqa o\'tdi, tozalandi');
      return {};
    }
    const { saved_at, ...rest } = parsed;
    return rest;
  } catch (err) {
    if (isLog) console.warn('ATTR: o\'qishda xato ->', err);
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

  // === URL tozalash (oxiridagi ] belgisi) ===
 const rawUrl = event?.context?.document?.location?.href ||
    initContext?.context?.document?.location?.href ||
    href;
  const currentUrl = rawUrl.replace(/\]$/, '');

  // === URL'dan joriy parametrlar ===
  const urlParams = new URL(currentUrl).searchParams;
  const currentUtmSource = urlParams.get('utm_source');
  const currentGclid = urlParams.get('gclid');

  // === Storefront'da yangi attribution bo'lsa -> saqlash ===
  if (currentUtmSource || currentGclid || urlParams.get('utm_medium') || urlParams.get('fbclid') || urlParams.get('wbraid')) {
    await persistAttribution(currentUrl);
  }

  // === localStorage'dan eski attribution (checkout fallback) ===
  const stored = await getAttribution();

  // === Yakuniy merge: URL > localStorage > cookie (gclid uchun) > null ===
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
    // QISM 2: marketing click-ID'lari
    fbc: marketingCookies.fbc,
    fbp: marketingCookies.fbp,
    gclid: gclid,
    gbraid: marketingCookies.gbraid,
    ttp: marketingCookies.ttp,
    // QISM 2b: URL asosidagi signallar + localStorage fallback
    wbraid: wbraid,
    utm_source: utm_source,
    utm_medium: utm_medium,
    utm_campaign: utm_campaign,
    utm_term: utm_term,
    utm_content: utm_content,
    fbclid: fbclid,
    // Server tomonida ANIQ filtr qo'yish uchun
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
      // Checkout sahifasi: hammasini dataLayer'ga yozamiz
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(data);
    } else if (isPageViewed) {
      // Checkout bo'lmagan sahifa: faqat page_viewed'ni parent'ga uzatamiz
      window.parent.postMessage(data, location.origin);
    }
    // Boshqa hollarda checkout'dan tashqarida push qilinmaydi
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
        handleAnalyticsEvent(event).catch((err) => console.error('handleAnalyticsEvent xatosi:', err));
      }
    });
  } else {
    analytics.subscribe("page_viewed", (event) => {
      handleAnalyticsEvent(event).catch((err) => console.error('handleAnalyticsEvent xatosi:', err));
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
// loadGTM — Stape'ning first-party (custom subdomain) GTM loader kodi.
// Bu qism o'zgartirilmadi — u allaqachon sizning shaxsiy subdomeningiz
// (data.farruxbek.online) orqali ishlaydi, shuning uchun adblocker'ga
// chidamli. Faqat shu funksiyagina qoldirildi, sp.stapecdn.com'ga fetch
// qiluvchi eski wrapper butunlay olib tashlandi.
// -----------------------------------------------------------------------
function loadGTM(key) {

  if (isInsertGTM) return;
  isInsertGTM = true;

  // Eslatma: avval bu yerda `key` (market ID) bo'yicha 3 xil `case` bor edi,
  // lekin ularning uchalasi ham baytma-bayt bir xil edi va useMultyMarkets
  // hozir `false` bo'lgani uchun bari bir `default`ga tushar edi — dead
  // code sifatida olib tashlandi.
  //
  // Quyidagi kod — Stape'ning minifikatsiya qilingan GTM loader snippet'i
  // BUTUNLAY BIR XIL MANTIQ bilan, lekin o'qiladigan, to'qnashmaydigan
  // o'zgaruvchi nomlari bilan qayta yozilgan. Sabab: minifikatsiya paytida
  // bir xil qisqa nom (d, g, v, E, f) bitta funksiya ichida ikki marta
  // qayta ishlatilgan edi — bu JS'da texnik jihatdan xato emas (`var` shu
  // tarzda qayta e'lon qilinaveradi), lekin Shopify muharriridagi
  // tekshiruvchi buni "already defined" / "used out of scope" deb
  // belgilardi. Har bir qadam original bilan solishtirib tekshirildi —
  // domen, konteyner ID va so'rov satri (query string) o'zgarishsiz qoldi.
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

    // ---- Stape konfiguratsiyasi (original qiymatlar, o'zgartirilmagan) ----
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
