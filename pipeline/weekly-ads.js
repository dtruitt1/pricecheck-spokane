import Anthropic from '@anthropic-ai/sdk';
import { STAPLES } from './items.js';

const client = new Anthropic();

async function fetchPricesViaClaude(storeName, storeFullName) {
  console.log(`[${storeName}] Using Claude web search for ${storeFullName} Spokane prices...`);
  const today = new Date().toISOString().split('T')[0];
  const results = [];
  const errors = [];

  const itemList = STAPLES.map(s => `- ${s.item_name} (${s.unit})`).join('\n');
  const userPrompt = `Search for current grocery prices at ${storeFullName} in Spokane, WA.
Search for "${storeFullName} Spokane weekly ad" and "${storeFullName} Spokane grocery prices 2026".

Find current prices for:
${itemList}

After searching, respond with ONLY a JSON array like this (no markdown, no explanation):
[{"item_name":"Whole milk","price":3.18,"unit":"gal"},{"item_name":"Large eggs","price":5.48,"unit":"doz"}]

Only include items where you found an actual price. Skip items you cannot find.`;

  try {
    // Agentic loop — keep going until stop_reason is 'end_turn'
    let messages = [{ role: 'user', content: userPrompt }];
    let finalText = '';
    let iterations = 0;

    while (iterations < 5) {
      iterations++;
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages,
      });

      // Add assistant response to message history
      messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'end_turn') {
        // Extract final text
        for (const block of response.content) {
          if (block.type === 'text') finalText = block.text;
        }
        break;
      }

      if (response.stop_reason === 'tool_use') {
        // Add tool results and continue loop
        const toolResults = response.content
          .filter(b => b.type === 'tool_use')
          .map(b => ({
            type: 'tool_result',
            tool_use_id: b.id,
            content: b.type === 'tool_use' ? 'Search executed.' : '',
          }));
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // Any other stop reason — grab text and exit
      for (const block of response.content) {
        if (block.type === 'text') finalText = block.text;
      }
      break;
    }

    console.log(`  [${storeName}] Raw response: ${finalText.slice(0, 200)}`);

    const clean = finalText.replace(/```json|```/g, '').trim();
    const match = clean.match(/\[[\s\S]*\]/);
    if (!match) throw new Error(`No JSON array in response. Got: ${finalText.slice(0, 100)}`);

    const items = JSON.parse(match[0]);
    for (const item of items) {
      if (!item.price) continue;
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
