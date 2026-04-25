/**
 * db.js — SQLite price store
 *
 * Schema:
 *   price_observations  raw ingested rows, append-only
 *   latest_prices       view: most recent price per (item_key, store)
 *   sync_log            one row per sync run for debugging
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dir, 'prices.db');

let _db = null;

export function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  initSchema(_db);
  return _db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_observations (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      item_key     TEXT    NOT NULL,
      item_name    TEXT    NOT NULL,
      store        TEXT    NOT NULL CHECK(store IN ('walmart','winco','fredmeyer','rosauers','manual')),
      price        REAL    NOT NULL CHECK(price > 0),
      unit         TEXT    NOT NULL,
      source       TEXT    NOT NULL CHECK(source IN ('walmart_api','weekly_ad','manual','community')),
      observed_at  TEXT    NOT NULL DEFAULT (date('now')),
      ad_end_date  TEXT,
      notes        TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_item_store ON price_observations(item_key, store, observed_at);

    CREATE TABLE IF NOT EXISTS sync_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      run_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      source      TEXT    NOT NULL,
      rows_added  INTEGER NOT NULL DEFAULT 0,
      errors      TEXT,
      duration_ms INTEGER
    );

    CREATE VIEW IF NOT EXISTS latest_prices AS
      SELECT
        p.item_key,
        p.item_name,
        p.store,
        p.price,
        p.unit,
        p.source,
        p.observed_at,
        p.ad_end_date
      FROM price_observations p
      INNER JOIN (
        SELECT item_key, store, MAX(observed_at) AS max_date
        FROM price_observations
        GROUP BY item_key, store
      ) m ON p.item_key = m.item_key
          AND p.store    = m.store
          AND p.observed_at = m.max_date;
  `);
}

/**
 * Upsert a batch of price rows.
 * Deduplicates on (item_key, store, observed_at) — safe to re-run.
 */
export function savePrices(rows) {
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO price_observations
      (item_key, item_name, store, price, unit, source, observed_at, ad_end_date, notes)
    VALUES
      (@item_key, @item_name, @store, @price, @unit, @source, @observed_at, @ad_end_date, @notes)
  `);
  const insertMany = db.transaction(rows => {
    let count = 0;
    for (const row of rows) count += insert.run(row).changes;
    return count;
  });
  return insertMany(rows);
}

export function logSync({ source, rows_added, errors, duration_ms }) {
  getDb().prepare(`
    INSERT INTO sync_log (source, rows_added, errors, duration_ms)
    VALUES (@source, @rows_added, @errors, @duration_ms)
  `).run({ source, rows_added, errors: errors ? JSON.stringify(errors) : null, duration_ms });
}

/**
 * Returns the current price basket as:
 * { item_key: { walmart, winco, fredmeyer, ... } }
 */
export function getPriceBasket() {
  const rows = getDb().prepare('SELECT * FROM latest_prices ORDER BY item_key, store').all();
  const basket = {};
  for (const row of rows) {
    if (!basket[row.item_key]) basket[row.item_key] = { item_name: row.item_name, unit: row.unit };
    basket[row.item_key][row.store] = { price: row.price, observed_at: row.observed_at, source: row.source };
  }
  return basket;
}

/**
 * Returns full price history for a single item_key, all stores.
 */
export function getPriceHistory(item_key, days = 90) {
  return getDb().prepare(`
    SELECT store, price, unit, observed_at, source
    FROM price_observations
    WHERE item_key = ?
      AND observed_at >= date('now', '-' || ? || ' days')
    ORDER BY observed_at ASC, store
  `).all(item_key, days);
}

/**
 * Export entire latest_prices as JSON — used by the app's /api/prices endpoint.
 */
export function exportPricesJson() {
  return getDb().prepare('SELECT * FROM latest_prices').all();
}
