/**
 * weekly-ads.js — fetches WinCo + Fred Meyer prices via Flipp search API
 *
 * Uses the Flipp backend search endpoint (backflipp.wishabi.com) which powers
 * the flipp.com app. No auth required, no PDF scraping, no bot detection.
 * Searches by item keyword + Spokane postal code, filters by store name.
 */

import Anthropic from '@anthropic-ai/sdk';
import { STAPLES, matchItemKey } from './items.js';

const client = new Anthropic();

const FLIPP_SEARCH = 'https://backflipp.wishabi.com/flipp/items/search';
const SPOKANE_ZIP  = '99201';

// Store name substrings to match in Flipp results
const STORE_MATCHERS = {
  winco:     ['winco'],
  fredmeyer: ['fred meyer', 'fredmeyer', 'fred'],
};

// ── Flipp search ─────────────────────────────────────────────────────────────

async function flippSearch(query, postalCode = SPOKANE_ZIP) {
  const url = `${FLIPP_SEARCH}?q=${encodeURIComponent(query)}&postal_code=${postalCode}`;
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      'Accept': 'application/json',
      'Referer': 'https://flipp.com/',
    }
  });
  if (!resp.ok) throw new Error(`Flipp API ${resp.status} for "${query}"`);
  return resp.json();
}

function extractPrice(item) {
  // Flipp items have current_price, sale_price, or price_text like "$3.99"
  if (item.current_price) return parseFloat(item.current_price);
  if (item.sale_price)    return parseFloat(item.sale_price);
  if (item.price_text) {
    const m = item.price_text.match(/\$?([\d.]+)/);
    if (m) return parseFloat(m[1]);
  }
  return null;
}

function matchesStore(item, storeMatchers) {
  const merchant = (item.merchant || item.store_name || '').toLowerCase();
  return storeMatchers.some(s => merchant.includes(s));
}

// ── Main fetch per store ──────────────────────────────────────────────────────

async function fetchFlippPrices(storeName) {
  console.log(`[${storeName}] Searching Flipp for ${STAPLES.length} items...`);
  const matchers = STORE_MATCHERS[storeName];
  const today    = new Date().toISOString().split('T')[0];
  const results  = [];
  const errors   = [];

  for (const staple of STAPLES) {
    try {
      await new Promise(r => setTimeout(r, 200)); // gentle rate limit
      const data = await flippSearch(staple.walmart_q);
      const items = data.items || [];

      // Filter to this store
      const storeItems = items.filter(i => matchesStore(i, matchers));

      if (!storeItems.length) {
        // Try shorter alias query
        const shortQuery = staple.aliases[0];
        const data2 = await flippSearch(shortQuery);
        const items2 = (data2.items || []).filter(i => matchesStore(i, matchers));
        storeItems.push(...items2);
      }

      if (!storeItems.length) {
        console.log(`  [${storeName}] No results for: ${staple.item_name}`);
        continue;
      }

      // Take lowest price among results
      const prices = storeItems
        .map(i => extractPrice(i))
        .filter(p => p && p > 0 && p < 100); // sanity check

      if (!prices.length) continue;
      const price = Math.min(...prices);

      results.push({
        item_key:    staple.item_key,
        item_name:   staple.item_name,
        store:       storeName,
        price,
        unit:        staple.unit,
        source:      'weekly_ad',
        observed_at: today,
        ad_end_date: null,
        notes:       `flipp search: ${staple.walmart_q}`,
      });

      console.log(`  [${storeName}] ${staple.item_name}: $${price.toFixed(2)}`);
    } catch(e) {
      errors.push(`${staple.item_key}: ${e.message}`);
      console.error(`  [${storeName}] Error for ${staple.item_name}:`, e.message);
    }
  }

  console.log(`[${storeName}] Done: ${results.length} items found`);
  return { results, errors };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function fetchWinCoAdPrices() {
  return fetchFlippPrices('winco');
}

export async function fetchFredMeyerAdPrices() {
  return fetchFlippPrices('fredmeyer');
}
