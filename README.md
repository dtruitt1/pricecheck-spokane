# Airbnb Tax Audit Scraper — Setup Guide

## What this does
Loops through all your Airbnb listing IDs, navigates to the booking page for each one,
and extracts the subtotal + tax amount to calculate the effective tax rate being collected.
Results are saved to a CSV you can open in Excel or Google Sheets.

---

## One-time setup (takes ~5 minutes)

### 1. Install Node.js (if you don't have it)
Open Terminal and run:
```
node --version
```
If you get a version number (e.g. `v20.11.0`), you already have it. Skip to step 2.

If not, install it from: https://nodejs.org (download the LTS version)

---

### 2. Set up the project folder

Create a folder on your Desktop called `airbnb-audit`, then open Terminal and run:

```bash
cd ~/Desktop/airbnb-audit
npm init -y
npm install playwright
npx playwright install chromium
```

This takes a few minutes — it downloads the browser engine.

---

### 3. Add your files

Copy these two files into your `airbnb-audit` folder:
- `airbnb_tax_audit.js` (the script)
- `listing_ids.csv` (your listing IDs — see format below)

---

### 4. Format your listing_ids.csv

Your CSV just needs one column. Either of these formats works:

**Option A — plain list (no header):**
```
37041123
37041124
37041125
```

**Option B — with header:**
```
listing_id
37041123
37041124
37041125
```

If your existing spreadsheet has other columns, just make sure one column is named `listing_id`.

---

### 5. Configure test dates (optional)

Open `airbnb_tax_audit.js` in any text editor and find the CONFIG section near the top.
Change `checkin` and `checkout` to dates that are:
- At least 2 weeks out from today
- A 4–7 night window (matching your typical minimum stay)

```js
checkin:  '2026-05-01',
checkout: '2026-05-05',
```

---

## Running the script

In Terminal, from your `airbnb-audit` folder:
```bash
node airbnb_tax_audit.js
```

1. A browser window will open and start working through your listings automatically
2. No login needed — the booking/price page is publicly accessible
3. Watch the progress in Terminal — you'll see each listing's result live

---

## Output

When done, open `airbnb_tax_audit_results.csv` in your `airbnb-audit` folder.

Columns:
| Column | Description |
|---|---|
| `listing_id` | Your Airbnb listing ID |
| `status` | OK / UNAVAILABLE / ERROR |
| `nights` | Number of nights in test window |
| `per_night_rate` | Nightly rate shown |
| `subtotal` | X nights × $rate |
| `taxes` | Tax amount charged by Airbnb |
| `total` | Grand total |
| `effective_tax_rate` | taxes ÷ subtotal × 100 |
| `error` | Description if something went wrong |

---

## Troubleshooting

**"Listing unavailable for selected dates"**
→ Change the test dates in CONFIG to a different window. Some listings have minimum stays
  or blocked periods. You may need to use 2–3 different date windows for different listing types.

**Many ERROR results**
→ Airbnb may be rate-limiting you. Increase `delayBetweenListings` from 3000 to 5000 or higher.

**Script crashes immediately**
→ Make sure `listing_ids.csv` is in the same folder as the script.

---

## Time estimate
With a 3-second delay between listings:
- 100 listings ≈ 5–6 minutes
- 648 listings ≈ 35–40 minutes

You can leave it running in the background.
