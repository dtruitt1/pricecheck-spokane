import { fetchWalmartPrices }       from './walmart.js';
import { fetchWinCoAdPrices, fetchFredMeyerAdPrices } from './weekly-ads.js';
import { savePrices, logSync, exportPricesJson } from './db.js';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir  = dirname(fileURLToPath(import.meta.url));
const args   = process.argv.slice(2);
const source = args.find(a => a.startsWith('--source='))?.split('=')[1]
            || (args.includes('--source') ? args[args.indexOf('--source') + 1] : 'all');
const dryRun = args.includes('--dry-run');

async function runSource(name, fetchFn) {
  const start = Date.now();
  console.log(`\n── ${name} ─────────────────────────────`);
  try {
    const raw = await fetchFn();
    const results = raw?.results || [];
    const errors  = raw?.errors  || [];
    const duration = Date.now() - start;

    if (dryRun) {
      console.log(`  [dry-run] Would save ${results.length} rows`);
      return { rowsSaved: 0, errors };
    }

    const rowsSaved = results.length ? savePrices(results) : 0;
    logSync({ source: name, rows_added: rowsSaved, errors, duration_ms: duration });
    console.log(`  Saved ${rowsSaved} new rows in ${duration}ms`);
    if (errors?.length) console.warn(`  Errors: ${errors.join(', ')}`);
    return { rowsSaved, errors };
  } catch(e) {
    console.error(`  [${name}] Fatal:`, e.message);
    return { rowsSaved: 0, errors: [e.message] };
  }
}

async function exportSnapshot() {
  const rows = exportPricesJson();
  const outPath = join(__dir, 'prices.json');
  writeFileSync(outPath, JSON.stringify({ updated_at: new Date().toISOString(), prices: rows }, null, 2));
  console.log(`\nExported ${rows.length} rows → prices.json`);
}

async function main() {
  console.log(`PriceCheck sync — ${new Date().toLocaleString()}`);
  console.log(`Source: ${source} | Dry run: ${dryRun}`);

  const runAll     = source === 'all';
  const runWalmart = runAll || source === 'walmart';
  const runAds     = runAll || source === 'ads';

  const summary = {};

  if (runWalmart) summary.walmart    = await runSource('walmart',    fetchWalmartPrices);
  if (runAds)     summary.winco      = await runSource('winco',      fetchWinCoAdPrices);
  if (runAds)     summary.fredmeyer  = await runSource('fredmeyer',  fetchFredMeyerAdPrices);

  if (!dryRun) await exportSnapshot();

  console.log('\n── Summary ──────────────────────────────');
  for (const [src, { rowsSaved, errors }] of Object.entries(summary)) {
    const errStr = errors?.length ? ` (${errors.length} errors)` : '';
    console.log(`  ${src.padEnd(12)} ${String(rowsSaved).padStart(3)} rows saved${errStr}`);
  }
  console.log('─────────────────────────────────────────\n');
}

main().catch(e => {
  console.error('Sync failed:', e);
  process.exit(1);
});
