/**
 * weekly-ads.js — fetches and parses WinCo / Fred Meyer weekly ad PDFs
 *
 * Flow:
 *   1. Fetch the weekly ad page (HTML)
 *   2. Find the PDF link (each retailer has a slightly different pattern)
 *   3. Download the PDF
 *   4. Extract raw text via pdf-parse
 *   5. Send text to Claude Haiku to extract structured price data
 *   6. Match extracted items against our canonical STAPLES list
 */

import Anthropic from '@anthropic-ai/sdk';
import pdfParse from 'pdf-parse';
import { matchItemKey, STAPLES } from './items.js';

const client = new Anthropic();

// ─── PDF text extraction ────────────────────────────────────────────────────

async function fetchPdfBuffer(url) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/pdf,*/*',
    },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
  const buf = await resp.arrayBuffer();
  return Buffer.from(buf);
}

async function extractPdfText(buffer) {
  const data = await pdfParse(buffer, { max: 8 }); // first 8 pages only
  return data.text;
}

// ─── Find PDF URL from weekly ad page ──────────────────────────────────────

async function findWinCoAdPdf() {
  // WinCo posts their ad at a predictable URL pattern;
  // fall back to scraping the page if not found.
  const PAGE_URL = 'https://www.wincofoods.com/savings/weekly-ad';
  try {
    const resp = await fetch(PAGE_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await resp.text();
    // Look for a .pdf link in the page
    const match = html.match(/https?:\/\/[^"']+\.pdf/i);
    if (match) return match[0];
  } catch (e) {
    console.warn('[winco] Could not scrape PDF URL:', e.message);
  }
  // Known direct URL pattern (may need updating weekly)
  return 'https://www.wincofoods.com/content/dam/winco/weekly-ad/weekly-ad.pdf';
}

async function findFredMeyerAdPdf() {
  const PAGE_URL = 'https://www.fredmeyer.com/d/weekly-ad';
  try {
    const resp = await fetch(PAGE_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await resp.text();
    const match = html.match(/https?:\/\/[^"']+(?:weekly[_-]?ad|circular)[^"']*\.pdf/i);
    if (match) return match[0];
    // Fred Meyer sometimes uses Kroger's Yummly ad CDN
    const krogerMatch = html.match(/https?:\/\/[^"']*kroger[^"']+\.pdf/i);
    if (krogerMatch) return krogerMatch[0];
  } catch (e) {
    console.warn('[fredmeyer] Could not scrape PDF URL:', e.message);
  }
  return null; // Fred Meyer is the most likely to fail — handled gracefully
}

// ─── Claude extraction ──────────────────────────────────────────────────────

async function extractPricesWithClaude(rawText, storeName) {
  // Truncate to ~6000 chars to stay within token budget and keep cost low
  const truncated = rawText.slice(0, 6000);

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001', // Haiku: cheap, fast, good enough for extraction
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `You are extracting grocery prices from a ${storeName} weekly ad.

Extract ALL food and household items that have a clear price. Focus on:
- Meat (beef, chicken, pork, fish)
- Dairy (milk, eggs, butter, cheese, yogurt)
- Produce (fruits, vegetables)
- Pantry staples (bread, pasta, oil, juice, cereal)
- Paper goods (toilet paper, paper towels)

Ignore: clothing, electronics, pharmacy, alcohol, prepared foods.

Return ONLY a JSON array, no markdown, no explanation:
[
  {
    "name": "product name as written in ad",
    "price": 2.99,
    "unit": "lb|each|gal|oz|ct|pack|loaf|doz",
    "sale_end": "MM/DD" or null,
    "limit": "limit 2" or null
  }
]

If a price is listed as "2 for $5", convert to per-unit: 2.50.
If price is "$.99/lb" style, extract 0.99.
If you cannot determine a clear price, skip the item.

AD TEXT:
${truncated}`
    }]
  });

  const text = msg.content[0].text.trim();
  // Strip any accidental markdown fences
  const clean = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

  try {
    return JSON.parse(clean);
  } catch (e) {
    console.error(`[${storeName}] JSON parse failed:`, e.message);
    console.error('Raw response:', text.slice(0, 300));
    return [];
  }
}

// ─── Match and normalize ────────────────────────────────────────────────────

function normalizeAdItems(extractedItems, storeName) {
  const today    = new Date().toISOString().split('T')[0];
  const results  = [];
  const unmatched = [];

  for (const item of extractedItems) {
    if (!item.price || item.price <= 0) continue;

    const staple = matchItemKey(item.name);
    if (!staple) {
      unmatched.push(item.name);
      continue;
    }

    // Compute ad end date
    let adEndDate = null;
    if (item.sale_end) {
      const year = new Date().getFullYear();
      try {
        adEndDate = new Date(`${item.sale_end}/${year}`).toISOString().split('T')[0];
      } catch {}
    }

    results.push({
      item_key:    staple.item_key,
      item_name:   staple.item_name,
      store:       storeName,
      price:       item.price,
      unit:        item.unit || staple.unit,
      source:      'weekly_ad',
      observed_at: today,
      ad_end_date: adEndDate,
      notes:       item.name + (item.limit ? ` (${item.limit})` : ''),
    });
  }

  if (unmatched.length) {
    console.log(`  [${storeName}] ${unmatched.length} unmatched items (not in staples basket)`);
  }

  return results;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function fetchWinCoAdPrices() {
  console.log('[winco] Fetching weekly ad PDF...');
  const errors = [];

  try {
    const pdfUrl = await findWinCoAdPdf();
    if (!pdfUrl) throw new Error('Could not find WinCo PDF URL');
    console.log(`  [winco] PDF URL: ${pdfUrl}`);

    const buffer  = await fetchPdfBuffer(pdfUrl);
    const rawText = await extractPdfText(buffer);
    console.log(`  [winco] Extracted ${rawText.length} chars from PDF`);

    const extracted = await extractPricesWithClaude(rawText, 'WinCo');
    console.log(`  [winco] Claude extracted ${extracted.length} items`);

    const results = normalizeAdItems(extracted, 'winco');
    console.log(`  [winco] Matched ${results.length} staples items`);

    return { results, errors };
  } catch (e) {
    errors.push(e.message);
    console.error('[winco] Fatal error:', e.message);
    return { results: [], errors };
  }
}

export async function fetchFredMeyerAdPrices() {
  console.log('[fredmeyer] Fetching weekly ad PDF...');
  const errors = [];

  try {
    const pdfUrl = await findFredMeyerAdPdf();
    if (!pdfUrl) {
      console.warn('[fredmeyer] No PDF URL found — skipping (Fred Meyer is bot-protected)');
      return { results: [], errors: ['No PDF URL found'] };
    }
    console.log(`  [fredmeyer] PDF URL: ${pdfUrl}`);

    const buffer  = await fetchPdfBuffer(pdfUrl);
    const rawText = await extractPdfText(buffer);
    console.log(`  [fredmeyer] Extracted ${rawText.length} chars from PDF`);

    const extracted = await extractPricesWithClaude(rawText, 'Fred Meyer');
    console.log(`  [fredmeyer] Claude extracted ${extracted.length} items`);

    const results = normalizeAdItems(extracted, 'fredmeyer');
    console.log(`  [fredmeyer] Matched ${results.length} staples items`);

    return { results, errors };
  } catch (e) {
    errors.push(e.message);
    console.error('[fredmeyer] Fatal error:', e.message);
    return { results: [], errors };
  }
}
