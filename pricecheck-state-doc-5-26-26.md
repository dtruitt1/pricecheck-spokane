PriceCheck — Technical State Document
Last updated: May 26, 2026
Repo: github.com/dtruitt1/pricecheck-spokane
Owner: Doug Truitt (dtruitt1)

1. Architecture & Stack Decisions
Overview
PriceCheck is a Spokane-area grocery price intelligence app. Users enter an item + price (or scan a barcode, or photograph a price tag) and get a GOOD / FAIR / HIGH verdict calibrated against real cross-store price data from local grocery stores.
Core architecture

Frontend: Single-file HTML/JS app — two copies: app/index.html (local dev) and index.html (repo root, served by GitHub Pages)
Hosting: GitHub Pages at https://dtruitt1.github.io/pricecheck-spokane — zero infrastructure, free, accessible from any device anywhere
Price intelligence: Claude Sonnet 4 (claude-sonnet-4-20250514) called directly from the browser via Anthropic Messages API
API key storage: Browser localStorage key pc_api_key — entered once per device via prompt() dialog on first use
Price data pipeline: Node.js scripts running on GitHub Actions weekly cron, outputting pipeline/prices.json committed back to repo
Price data consumed by app: Raw GitHub URL (raw.githubusercontent.com) fetched at app startup — zero server infrastructure needed
Database: SQLite (better-sqlite3) used by pipeline during sync runs; ephemeral on GitHub Actions runners; final output is prices.json

Key arch decision this session

No hardcoded API key — GitHub/Anthropic secret scanning partnership auto-revokes any Anthropic key committed to a public repo within seconds. Key must live in localStorage only, never in source code.
GitHub Pages serves from repo root — Pages only supports / (root) or /docs folder on free accounts, not /app. So index.html at repo root is the canonical hosted file; app/index.html is the local dev copy. Always keep them in sync via cp app/index.html index.html.
prompt() for API key entry — A custom modal overlay approach caused layout issues on GitHub Pages (app rendered at zero height). Replaced with native browser prompt() dialog which works reliably everywhere.


2. Current State — What's Built and Working
GitHub Pages (hosted, any device, any network)

✅ Live at https://dtruitt1.github.io/pricecheck-spokane
✅ First-time visitors see a prompt() asking for Anthropic API key — entered once, stored in localStorage permanently
✅ Subsequent visits go straight to the app
✅ Works on mobile, off-network, no Mac required

Pipeline (runs weekly via GitHub Actions)

✅ WinCo: 14 items from hardcoded baseline
✅ Fred Meyer: 14 real prices from Kroger API (store: Wandermere, locationId: 70100214)
✅ prices.json committed back to repo after each sync
❌ Safeway/Albertsons: auth failing
❌ Rosauers: web search returning 0 items
⏳ Walmart: fetcher written but credentials not obtained

App (index.html / app/index.html)

✅ Check tab — manual item + price entry → GOOD/FAIR/HIGH verdict with store price grid
✅ Barcode tab — ZXing camera scanner + Open Food Facts UPC lookup + verdict
✅ Photo tab — Claude Vision reads price tags → extracts item + price → verdict
✅ Index tab — 6-store toggle, staples basket table, markup % bar chart
✅ History tab — last 100 checks in localStorage
✅ Live price data from prices.json on GitHub with sync badge
✅ Estimated fallback if fetch fails


3. File Paths, Repo Structure, Config Details
Repo structure
pricecheck-spokane/
├── .github/
│   └── workflows/
│       └── weekly-sync.yml        # GitHub Actions cron (Sundays 11pm PT)
├── app/
│   └── index.html                 # Local dev copy — run via python3 -m http.server 8080
├── pipeline/
│   ├── package.json
│   ├── sync.js                    # Orchestrator
│   ├── weekly-ads.js              # WinCo baseline + Kroger API + Safeway + Rosauers
│   ├── walmart.js                 # Walmart fetcher (skipped — no credentials)
│   ├── db.js                      # SQLite schema + helpers
│   ├── items.js                   # Canonical 14-item staples basket
│   ├── server.js                  # Optional Express API (not deployed)
│   └── prices.json                # AUTO-GENERATED weekly
├── index.html                     # ROOT copy — served by GitHub Pages
└── README.md
Critical: two index.html files must stay in sync

app/index.html — edit this one during development
index.html — always sync before pushing: cp app/index.html index.html
GitHub Pages serves index.html at root

Running locally
bashcd ~/pricecheck-spokane/app
python3 -m http.server 8080
# Desktop: http://localhost:8080
# Phone on same WiFi: http://192.168.4.110:8080 (verify IP with: ipconfig getifaddr en0)
API key management

Never hardcode the Anthropic API key in source files — GitHub + Anthropic have a secret scanning partnership that auto-revokes exposed keys instantly
Key is stored in localStorage as pc_api_key
To set manually via browser console: localStorage.setItem('pc_api_key', 'sk-ant-...')
First-time users are prompted via native prompt() dialog on first API call
To reset on a device: localStorage.removeItem('pc_api_key') in console

GitHub Secrets configured
SecretPurposeANTHROPIC_API_KEYPipeline ad parsingKROGER_CLIENT_IDpricecheck-spokane-bbcdqtkxKROGER_CLIENT_SECRETKroger API authSAFEWAY_EMAILSafeway/Albertsons (broken)SAFEWAY_PASSWORDSafeway/Albertsons (broken)WALMART_CONSUMER_IDNot yet obtainedWALMART_PRIVATE_KEYNot yet obtained

4. Problems Solved and How
ProblemSolutioninvalid x-api-key errorKey in localStorage was stale/missing; created new key at console.anthropic.com and set via localStorage.setItem('pc_api_key', '...') in browser consolesdetItem is not a functionTypo — sdetItem should be setItemPhone couldn't connect on same WiFiIP had changed; use ipconfig getifaddr en0 to get current IPGitHub Pages only offers root or /docsCopied app/index.html to repo root as index.html; Pages set to main / / (root)GitHub push blocked — secret detectedGitHub/Anthropic auto-revoke keys committed to public repos; removed hardcoded key entirely, switched to localStorage + prompt()Anthropic auto-revoked API keyKey was committed to public repo; rotated key at console.anthropic.comCustom modal overlay caused black screen on GitHub PagesApp div rendered at zero height when overlay was present; replaced custom modal with native browser prompt() which works reliablyGit push rejected after Actions bot committedgit stash && git pull origin main --rebase && git stash pop && git push

5. Open Issues / Bugs
Two index.html files to maintain
Every change to app/index.html must be synced to root index.html before pushing. Easy to forget. Consider a pre-commit hook or GitHub Action to automate the sync.
Safeway & Albertsons auth broken

Error: 401 invalid_client
Fix: Intercept fresh Okta client ID from current Safeway iOS app via mitmproxy, or use web_fetch on safeway.com/weeklyad directly

Rosauers returning 0 items

Fix: Replace web search with direct web_fetch on https://www.rosauers.com/savings/weekly-specials

Walmart not configured

Register at developer.walmart.com → get Consumer ID + Private Key → add as GitHub Secrets
Fetcher in walmart.js is already written

npm install slow on GitHub Actions (~1 min)

better-sqlite3 requires native compilation
Fix: commit package-lock.json and restore npm cache in workflow

App version badge shows "v3" but is v4 functionality

Minor cosmetic issue in index.html header


6. Next Steps
Priority 1 — Automate index.html sync
Add a GitHub Action or pre-commit hook to automatically copy app/index.html → index.html on every push to avoid drift between the two files.
Priority 2 — Fix Safeway/Albertsons
Use web_fetch on safeway.com/weeklyad directly instead of Okta auth — page renders sale prices in HTML Claude can parse.
Priority 3 — Fix Rosauers
javascript// In weekly-ads.js fetchRosauerspPrices():
const resp = await fetch('https://www.rosauers.com/savings/weekly-specials');
const html = await resp.text();
// Pass html to Claude for price extraction
Priority 4 — Walmart API

Register at developer.walmart.com
Add WALMART_CONSUMER_ID and WALMART_PRIVATE_KEY to GitHub Secrets
Fetcher already written in pipeline/walmart.js

Priority 5 — Smart shopping lists
When a user gets a FAIR or HIGH verdict, offer one-tap "Add to [Store] list" to save the item at the better price. Lists organized by store, persisted in localStorage.
Priority 6 — Budget planner
Planning mode: build a list from frequently checked items, assign quantities, see projected total per store, get optimal store split recommendation based on live prices.json data.
Priority 7 — Expand staples basket
Add to pipeline/items.js: apples, carrots, onions, pork chops, canned tuna, Greek yogurt, dish soap, laundry detergent.
Priority 8 — Price history charts
getPriceHistory(item_key, days) already written in db.js. Needs Railway deployment of server.js to expose /api/prices/:item_key endpoint, then chart view in Index tab.

Appendix — Canonical Item Keys
milk_whole_gallon       eggs_large_dozen        ground_beef_8020_lb
chicken_breast_lb       bread_white_loaf        butter_salted_lb
cheddar_cheese_lb       bananas_lb              potatoes_russet_5lb
toilet_paper_12pk       paper_towels_6pk        pasta_spaghetti_16oz
canola_oil_48oz         orange_juice_52oz
Appendix — Weekly Sync Schedule

Cron: 0 7 * * 1 (Mondays 7:00 UTC = Sunday 11pm PT)
Manual trigger: GitHub Actions tab → Weekly price sync → Run workflow
