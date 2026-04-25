/**
 * walmart.js — fetches prices from Walmart Open API
 *
 * Docs: https://developer.walmart.com/api/us/mp/items
 * Free tier: 200 req/min, no seller account needed for product search.
 *
 * Setup:
 *   1. Register at developer.walmart.com
 *   2. Create an app → get Consumer ID + Private Key
 *   3. Set env vars: WALMART_CONSUMER_ID, WALMART_PRIVATE_KEY
 *
 * Auth uses HMAC-SHA256 signed headers per Walmart's spec.
 */

import crypto from 'crypto';
import { STAPLES } from './items.js';

const BASE_URL = 'https://developer.api.walmart.com/api-proxy/service/affil/product/v2';

function buildAuthHeaders(consumerId, privateKey) {
  const timestamp = Date.now().toString();
  const version   = '1';
  const toSign    = `${consumerId}\n${timestamp}\n${version}\n`;
  const sign      = crypto
    .createSign('RSA-SHA256')
    .update(toSign)
    .sign(privateKey, 'base64');

  return {
    'WM_SEC.KEY_VERSION':   version,
    'WM_CONSUMER.ID':       consumerId,
    'WM_SEC.AUTH_SIGNATURE':sign,
    'WM_CONSUMER.intimestamp': timestamp,
    'Accept': 'application/json',
  };
}

/**
 * Search Walmart for a query term, return the lowest-priced matching item.
 */
async function searchWalmart(query, headers) {
  const url = `${BASE_URL}/search?query=${encodeURIComponent(query)}&numItems=5&responseGroup=base`;
  const resp = await fetch(url, { headers });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Walmart API ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = await resp.json();
  const items = data.items || [];
  if (!items.length) return null;

  // Sort by sale price, take lowest
  items.sort((a, b) => (a.salePrice || a.msrp || 999) - (b.salePrice || b.msrp || 999));
  const best = items[0];

  return {
    name:  best.name,
    price: best.salePrice || best.msrp,
    url:   best.productUrl,
  };
}

/**
 * Fetch current Walmart prices for all STAPLES items.
 * Returns array of price_observations rows.
 */
export async function fetchWalmartPrices() {
  const consumerId  = process.env.WALMART_CONSUMER_ID;
  const privateKey  = process.env.WALMART_PRIVATE_KEY;

  if (!consumerId || !privateKey) {
    console.warn('[walmart] No credentials — skipping. Set WALMART_CONSUMER_ID and WALMART_PRIVATE_KEY.');
    return [];
  }

  const headers = buildAuthHeaders(consumerId, privateKey);
  const today   = new Date().toISOString().split('T')[0];
  const results = [];
  const errors  = [];

  for (const item of STAPLES) {
    try {
      // Rate limit: 200 req/min — 300ms between calls is plenty
      await new Promise(r => setTimeout(r, 300));

      const result = await searchWalmart(item.walmart_q, headers);
      if (!result || !result.price) {
        errors.push(`No result for: ${item.walmart_q}`);
        continue;
      }

      results.push({
        item_key:    item.item_key,
        item_name:   item.item_name,
        store:       'walmart',
        price:       result.price,
        unit:        item.unit,
        source:      'walmart_api',
        observed_at: today,
        ad_end_date: null,
        notes:       result.name,
      });

      console.log(`  [walmart] ${item.item_name}: $${result.price}`);
    } catch (e) {
      errors.push(`${item.item_key}: ${e.message}`);
      console.error(`  [walmart] Error for ${item.item_key}:`, e.message);
    }
  }

  return { results, errors };
}
