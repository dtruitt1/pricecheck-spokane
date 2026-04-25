/**
 * server.js — lightweight HTTP API for the PriceCheck app
 *
 * Endpoints:
 *   GET /api/prices          latest prices for all staples, all stores
 *   GET /api/prices/:item    price history for a single item_key
 *   GET /api/health          uptime + last sync info
 *
 * In production: run behind nginx or on Railway.
 * For local/GitHub Actions: the app reads prices.json directly (no server needed).
 */

import { createServer } from 'http';
import { getPriceBasket, getPriceHistory, exportPricesJson, getDb } from './db.js';

const PORT = process.env.PORT || 3001;

function json(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=3600', // cache 1hr — prices don't change intraday
  });
  res.end(JSON.stringify(data));
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
    res.end();
    return;
  }

  try {
    if (path === '/api/prices' && req.method === 'GET') {
      const basket = getPriceBasket();
      json(res, { updated_at: new Date().toISOString(), basket });

    } else if (path.startsWith('/api/prices/') && req.method === 'GET') {
      const item_key = path.replace('/api/prices/', '');
      const days     = parseInt(url.searchParams.get('days') || '90');
      const history  = getPriceHistory(item_key, days);
      json(res, { item_key, history });

    } else if (path === '/api/export' && req.method === 'GET') {
      // Full flat export — used by the app when running without the server
      const prices = exportPricesJson();
      json(res, { updated_at: new Date().toISOString(), prices });

    } else if (path === '/api/health' && req.method === 'GET') {
      const lastSync = getDb()
        .prepare('SELECT * FROM sync_log ORDER BY run_at DESC LIMIT 5')
        .all();
      json(res, { status: 'ok', last_syncs: lastSync });

    } else {
      json(res, { error: 'Not found' }, 404);
    }
  } catch (e) {
    console.error('Server error:', e);
    json(res, { error: e.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`PriceCheck API running on http://localhost:${PORT}`);
  console.log('Endpoints: /api/prices  /api/prices/:item_key  /api/health');
});
