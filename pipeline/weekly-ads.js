/**
 * weekly-ads.js — uses Claude with web search to find current grocery prices
 * in Spokane, WA for WinCo and Fred Meyer.
 *
 * WinCo is not on Flipp or any ad aggregator (employee-owned, no partnerships).
 * Fred Meyer's Flipp integration doesn't cover Spokane well.
 * Claude's web search finds current prices from grocery comparison sites,
 * store websites, and weekly ad aggregators like myweeklyads.net.
 */

import Anthropic from '@anthropic-ai/sdk';
import { STAPLES } from './items.js';

const client = new Anthropic();

async function fetchPricesViaClaude(storeName, storeFullName) {
  console.log(`[${storeName}] Using Claude web search for ${storeFullName} Spokane prices...`);
  const today    = new Date().toISOString().split('T')[0];
  const results  = [];
  const errors   = [];

  // Build a single prompt asking for all staples at once to minimize API calls
  const itemList = STAPLES.map(s => `- ${s.item_name} (${s.unit})`).join('\n');

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `Search for current grocery prices at ${storeFullName} in Spokane, WA (zip 99206).

Find current prices for these items:
${itemList}

Search for "${storeFullName} Spokane weekly ad prices" and similar queries.
Use sources like myweeklyads.net, the store's own website, or grocery price comparison sites.

Return ONLY a JSON array, no markdown:
[
  {"item_name": "Whole milk", "price": 3.18, "unit": "gal", "found": true},
  {"item_name": "Large eggs", "price": 5.48, "unit": "doz", "found": true}
]

If you cannot find a price for an item, set "found": false and omit the price.
Only include items where you have reasonable confidence in the price.`
      }]
    });

    // Extract final text response (after tool use)
    let finalText = '';
    for (const block of msg.content) {
      if (block.type === 'text') finalText = block.text;
    }

    // Handle multi-turn tool use
    if (msg.stop_reason === 'tool_use') {
      const toolResults = msg.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: 'Search completed.' }));

      const msg2 = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [
          { role: 'user', content: msg.content[0]?.text || '' },
          { role: 'assistant', content: msg.content },
          { role: 'user', content: toolResults }
        ]
      });
      for (const block of msg2.content) {
        if (block.type === 'text') finalText = block.text;
      }
    }

    const clean = finalText.replace(/```json|```/g, '').trim();
    const match = clean.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array in response');

    const items = JSON.parse(match[0]);
    for (const item of items) {
      if (!item.found || !item.price) continue;
      const staple = STAPLES.find(s =>
        s.item_name.toLowerCase() === item.item_name.toLowerCase()
      );
      if (!staple) continue;

      results.push({
        item_key:    staple.item_key,
        item_name:   staple.item_name,
        store:       storeName,
        price:       parseFloat(item.price),
        unit:        item.unit || staple.unit,
        source:      'weekly_ad',
        observed_at: today,
        ad_end_date: null,
        notes:       'claude web search',
      });
      console.log(`  [${storeName}] ${staple.item_name}: $${item.price}`);
    }

    console.log(`[${storeName}] Done: ${results.length} items found`);
  } catch(e) {
    errors.push(e.message);
    console.error(`[${storeName}] Error:`, e.message);
  }

  return { results, errors };
}

export async function fetchWinCoAdPrices() {
  return fetchPricesViaClaude('winco', 'WinCo Foods');
}

export async function fetchFredMeyerAdPrices() {
  return fetchPricesViaClaude('fredmeyer', 'Fred Meyer');
}
