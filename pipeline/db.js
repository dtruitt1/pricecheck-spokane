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
  initSchema(_db);
  return _db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_key TEXT NOT NULL, item_name TEXT NOT NULL,
      store TEXT NOT NULL CHECK(store IN ('walmart','winco','fredmeyer','safeway','albertsons','rosauers','manual')),
      price REAL NOT NULL CHECK(price > 0), unit TEXT NOT NULL, source TEXT NOT NULL,
      observed_at TEXT NOT NULL DEFAULT (date('now')), ad_end_date TEXT, notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_item_store ON price_observations(item_key, store, observed_at);
    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, run_at TEXT NOT NULL DEFAULT (datetime('now')),
      source TEXT NOT NULL, rows_added INTEGER NOT NULL DEFAULT 0, errors TEXT, duration_ms INTEGER
    );
    CREATE VIEW IF NOT EXISTS latest_prices AS
      SELECT p.item_key, p.item_name, p.store, p.price, p.unit, p.source, p.observed_at, p.ad_end_date
      FROM price_observations p
      INNER JOIN (SELECT item_key, store, MAX(observed_at) AS max_date FROM price_observations GROUP BY item_key, store) m
      ON p.item_key=m.item_key AND p.store=m.store AND p.observed_at=m.max_date;
  `);
}

export function savePrices(rows) {
  const db = getDb();
  const insert = db.prepare(`INSERT OR IGNORE INTO price_observations (item_key,item_name,store,price,unit,source,observed_at,ad_end_date,notes) VALUES (@item_key,@item_name,@store,@price,@unit,@source,@observed_at,@ad_end_date,@notes)`);
  const insertMany = db.transaction(rows => { let c=0; for (const r of rows) c+=insert.run(r).changes; return c; });
  return insertMany(rows);
}

export function logSync({ source, rows_added, errors, duration_ms }) {
  getDb().prepare(`INSERT INTO sync_log (source,rows_added,errors,duration_ms) VALUES (@source,@rows_added,@errors,@duration_ms)`)
    .run({ source, rows_added, errors: errors ? JSON.stringify(errors) : null, duration_ms });
}

export function exportPricesJson() {
  return getDb().prepare('SELECT * FROM latest_prices').all();
}
