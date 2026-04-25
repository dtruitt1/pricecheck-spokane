import Anthropic from '@anthropic-ai/sdk';
import { STAPLES } from './items.js';

const client = new Anthropic();

// ── WinCo manual baseline ─────────────────────────────────────────────────────
const WINCO_BASELINE = {
  milk_whole_gallon:3.18, eggs_large_dozen:5.48, ground_beef_8020_lb:4.48,
  chicken_breast_lb:2.78, bread_white_loaf:1.98, butter_salted_lb:3.98,
  cheddar_cheese_lb:4.28, bananas_lb:0.39, potatoes_russet_5lb:3.48,
  toilet_paper_12pk:8.98, paper_towels_6pk:7.98, pasta_spaghetti_16oz:0.98,
  canola_oil_48oz:4.28, orange_juice_52oz:3.98,
};

export async function fetchWinCoAdPrices() {
  console.log('[winco] Loading manual baseline...');
  const today = new Date().toISOString().split('T')[0];
  const results = STAPLES.filter(s => WINCO_BASELINE[s.item_key]).map(s => ({
    item_key:s.item_key, item_name:s.item_name, store:'winco',
    price:WINCO_BASELINE[s.item_key], unit:s.unit, source:'manual',
    observed_at:today, ad_end_date:null, notes:'manual baseline',
  }));
  console.log(`[winco] Done: ${results.length} items`);
  return { results, errors:[] };
}

// ── Kroger API (Fred Meyer) ───────────────────────────────────────────────────

async function getKrogerToken() {
  const clientId = process.env.KROGER_CLIENT_ID;
  const clientSecret = process.env.KROGER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const resp = await fetch('https://api.kroger.com/v1/connect/oauth2/token', {
    method:'POST',
    headers:{'Authorization':`Basic ${creds}`,'Content-Type':'application/x-www-form-urlencoded'},
    body:'grant_type=client_credentials&scope=product.compact',
  });
  if (!resp.ok) throw new Error(`Kroger auth failed: ${resp.status}`);
  return (await resp.json()).access_token;
}

async function getKrogerLocationId(token) {
  const resp = await fetch(
    'https://api.kroger.com/v1/locations?filter.zipCode.near=99218&filter.radiusInMiles=15&filter.limit=5',
    { headers:{'Authorization':`Bearer ${token}`,'Accept':'application/json'} }
  );
  if (!resp.ok) throw new Error(`Kroger locations failed: ${resp.status}`);
  const locs = (await resp.json()).data || [];
  console.log(`  [fredmeyer] Stores near 99218:`, locs.map(l=>`${l.name}(${l.locationId})`).join(', '));
  const fm = locs.find(l => l.name?.toLowerCase().includes('fred') || l.chain?.toLowerCase().includes('fred'));
  if (!fm) throw new Error(`No Fred Meyer found. Got: ${locs.map(l=>l.name).join(', ')}`);
  console.log(`  [fredmeyer] Using: ${fm.name} (${fm.locationId})`);
  return fm.locationId;
}

async function searchKrogerProduct(token, locationId, query) {
  const url = `https://api.kroger.com/v1/products?filter.term=${encodeURIComponent(query)}&filter.locationId=${locationId}&filter.limit=5`;
  const resp = await fetch(url, { headers:{'Authorization':`Bearer ${token}`,'Accept':'application/json'} });
  if (!resp.ok) throw new Error(`Kroger products failed: ${resp.status}`);
  return (await resp.json()).data || [];
}

function extractKrogerPrice(product) {
  for (const item of (product.items || [])) {
    const price = item.price;
    if (!price) continue;
    return price.promo > 0 ? price.promo : price.regular;
  }
  return null;
}

export async function fetchFredMeyerAdPrices() {
  console.log('[fredmeyer] Fetching via Kroger Public API...');
  const errors = [], results = [], today = new Date().toISOString().split('T')[0];
  try {
    const token = await getKrogerToken();
    if (!token) { console.warn('[fredmeyer] No Kroger credentials.'); return { results:[], errors:['No credentials'] }; }
    const locationId = await getKrogerLocationId(token);
    await new Promise(r => setTimeout(r, 500));
    for (const staple of STAPLES) {
      try {
        await new Promise(r => setTimeout(r, 250));
        let products = await searchKrogerProduct(token, locationId, staple.walmart_q);
        if (!products.length) products = await searchKrogerProduct(token, locationId, staple.aliases[0]);
        if (!products.length) { console.log(`  [fredmeyer] No results: ${staple.item_name}`); continue; }
        const prices = products.map(extractKrogerPrice).filter(p => p && p > 0 && p < 200);
        if (!prices.length) continue;
        const price = Math.min(...prices);
        results.push({ item_key:staple.item_key, item_name:staple.item_name, store:'fredmeyer',
          price, unit:staple.unit, source:'walmart_api', observed_at:today, ad_end_date:null, notes:'kroger api' });
        console.log(`  [fredmeyer] ${staple.item_name}: $${price.toFixed(2)}`);
      } catch(e) { errors.push(`${staple.item_key}: ${e.message}`); }
    }
  } catch(e) { errors.push(e.message); console.error('[fredmeyer] Fatal:', e.message); }
  console.log(`[fredmeyer] Done: ${results.length} items`);
  return { results, errors };
}

// ── Safeway/Albertsons via Okta auth ──────────────────────────────────────────
// Safeway uses Okta for identity. The Okta app ID for Safeway is ausp6soxrIyPrm8rS2p6.
// This uses the Resource Owner Password flow which works for programmatic access.

async function getSafewayOktaToken(email, password) {
  const resp = await fetch('https://albertsons.okta.com/oauth2/ausp6soxrIyPrm8rS2p6/v1/token', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic YW5kcm9pZC1zYWZld2F5LWN1c3RvbWVyOg==', // public app client creds
    },
    body: new URLSearchParams({
      username: email,
      password: password,
      grant_type: 'password',
      scope: 'openid profile offline_access',
    }).toString(),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Safeway Okta auth failed: ${resp.status} ${text.slice(0,100)}`);
  }
  const data = await resp.json();
  return data.access_token;
}

async function getSafewayStoreId(token, zip = '99206') {
  const resp = await fetch(
    `https://www.safeway.com/abs/pub/xapi/storelocator/homepagedefault?zipcode=${zip}&radius=10&limit=1`,
    { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } }
  );
  if (!resp.ok) throw new Error(`Safeway store lookup failed: ${resp.status}`);
  const data = await resp.json();
  const stores = data.stores || data.data || [];
  if (!stores.length) throw new Error(`No Safeway near ${zip}`);
  console.log(`  [safeway] Store: ${stores[0].name} (${stores[0].storeId||stores[0].id})`);
  return stores[0].storeId || stores[0].id;
}

async function searchSafewayProduct(token, storeId, query) {
  const url = `https://www.safeway.com/abs/pub/xapi/pgmstoredtls/api/search?request-id=1&q=${encodeURIComponent(query)}&rows=5&store-id=${storeId}&dvid=web&channel=instore`;
  const resp = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
  });
  if (!resp.ok) throw new Error(`Safeway search failed: ${resp.status}`);
  const data = await resp.json();
  return data.results || data.items || data.products || [];
}

function extractSafewayPrice(item) {
  if (item.salePrice)    return parseFloat(item.salePrice);
  if (item.pricePer)     return parseFloat(item.pricePer);
  if (item.regularPrice) return parseFloat(item.regularPrice);
  if (item.price)        return parseFloat(item.price);
  return null;
}

async function fetchSafewayAlbertsons(storeName) {
  const email    = process.env.SAFEWAY_EMAIL;
  const password = process.env.SAFEWAY_PASSWORD;
  if (!email || !password) {
    console.warn(`[${storeName}] No credentials — skipping`);
    return { results:[], errors:['No credentials'] };
  }
  console.log(`[${storeName}] Fetching via Safeway Okta API...`);
  const errors = [], results = [], today = new Date().toISOString().split('T')[0];
  try {
    const token   = await getSafewayOktaToken(email, password);
    const storeId = await getSafewayStoreId(token);
    await new Promise(r => setTimeout(r, 500));
    for (const staple of STAPLES) {
      try {
        await new Promise(r => setTimeout(r, 300));
        let items = await searchSafewayProduct(token, storeId, staple.walmart_q);
        if (!items.length) items = await searchSafewayProduct(token, storeId, staple.aliases[0]);
        if (!items.length) { console.log(`  [${storeName}] No results: ${staple.item_name}`); continue; }
        const prices = items.map(extractSafewayPrice).filter(p => p && p > 0 && p < 200);
        if (!prices.length) continue;
        const price = Math.min(...prices);
        results.push({ item_key:staple.item_key, item_name:staple.item_name, store:storeName,
          price, unit:staple.unit, source:'walmart_api', observed_at:today, ad_end_date:null, notes:'safeway okta api' });
        console.log(`  [${storeName}] ${staple.item_name}: $${price.toFixed(2)}`);
      } catch(e) { errors.push(`${staple.item_key}: ${e.message}`); }
    }
  } catch(e) { errors.push(e.message); console.error(`[${storeName}] Fatal:`, e.message); }
  console.log(`[${storeName}] Done: ${results.length} items`);
  return { results, errors };
}

export async function fetchSafewayPrices()    { return fetchSafewayAlbertsons('safeway'); }
export async function fetchAlbertsonsPrices() { return fetchSafewayAlbertsons('albertsons'); }

// ── Rosauers via web search ───────────────────────────────────────────────────

async function fetchViaWebSearch(storeName, storeFullName, searchPrompt) {
  console.log(`[${storeName}] Web search for ${storeFullName}...`);
  const today = new Date().toISOString().split('T')[0];
  const results = [], errors = [];
  const itemList = STAPLES.map(s => `${s.item_name} (${s.unit})`).join(', ');
  try {
    let messages = [{ role:'user', content:`${searchPrompt}\nFind prices for: ${itemList}\nReturn ONLY JSON array: [{"item_name":"Whole milk","price":3.99,"unit":"gal"}]. Return [] if none found.` }];
    let finalText = '[]', iters = 0;
    while (iters < 6) {
      iters++;
      const resp = await client.messages.create({
        model:'claude-haiku-4-5-20251001', max_tokens:1024,
        tools:[{type:'web_search_20250305',name:'web_search'}], messages,
      });
      messages.push({ role:'assistant', content:resp.content });
      if (resp.stop_reason === 'end_turn') { for (const b of resp.content) if (b.type==='text') finalText=b.text; break; }
      if (resp.stop_reason === 'tool_use') {
        const tr = resp.content.filter(b=>b.type==='tool_use').map(b=>({type:'tool_result',tool_use_id:b.id,content:'Done.'}));
        messages.push({ role:'user', content:tr });
      }
    }
    const match = finalText.match(/\[[\s\S]*?\]/);
    if (!match) { console.log(`  [${storeName}] No prices found`); return { results, errors }; }
    for (const item of JSON.parse(match[0])) {
      if (!item.price) continue;
      const staple = STAPLES.find(s => s.item_name.toLowerCase() === item.item_name.toLowerCase());
      if (!staple) continue;
      results.push({ item_key:staple.item_key, item_name:staple.item_name, store:storeName,
        price:parseFloat(item.price), unit:item.unit||staple.unit, source:'weekly_ad',
        observed_at:today, ad_end_date:null, notes:'web search' });
      console.log(`  [${storeName}] ${staple.item_name}: $${item.price}`);
    }
  } catch(e) { errors.push(e.message); console.error(`[${storeName}] Error:`, e.message); }
  console.log(`[${storeName}] Done: ${results.length} items`);
  return { results, errors };
}

export async function fetchRosauerspPrices() {
  return fetchViaWebSearch('rosauers', 'Rosauers',
    'Search "Rosauers weekly ad Spokane" on rosauers.com or myweeklyads.net. Local Spokane grocery chain.');
}
