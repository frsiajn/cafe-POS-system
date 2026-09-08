# Bloom & Brew — Inventory Backend

Adds a SQL-backed inventory layer behind the POS: ingredient stock levels,
batch shelf-life tracking, consumption history, and simulated restock alerts.

## Setup

```bash
cd backend
npm install
npm run demo     # seeds sample data and prints usage rates + alerts to the console
```

## Files

| File | Purpose |
|---|---|
| `../database/schema.sql` | Tables: `products`, `batches`, `consumption_log`, `restock_alerts` |
| `../database/queries.sql` | Standalone, annotated SQL for inventory levels, expiring batches, consumption trends, waste rate, FIFO lookup |
| `db.js` | Opens `cafe-inventory.db` (SQLite file, created automatically) and applies the schema |
| `inventory.js` | Core logic: `calculateUsageRate()`, `simulateRestockAlerts()`, etc. |
| `seed.js` | Fills the database with 8 sample pantry items, batches, and 21 days of consumption |
| `demo.js` | Runs the seed + both core functions and prints the results as tables |
| `server.js` | Minimal REST API so the POS frontend can read/write this data |

## Running the API

```bash
npm start
```

Starts on `http://localhost:3001` with:

- `GET /api/inventory` — current stock per ingredient
- `GET /api/usage/:sku?days=14` — usage rate for one product
- `GET /api/alerts` — open restock/expiry alerts
- `POST /api/simulate` — re-run the alert simulation on demand
- `POST /api/consume` — log ingredient usage from a checked-out order, e.g.:

```json
{
  "orderRef": "00125",
  "items": [
    { "sku": "MILK-WHL", "qty": 180 },
    { "sku": "BEAN-ARB", "qty": 18 }
  ]
}
```

## Wiring it into the POS frontend

The POS (`index.html` / `script.js`) currently tracks menu items (Latte,
Muffin, etc.), not raw ingredients — this backend tracks the ingredients
those menu items are made from (coffee beans, milk, flour...). To connect
them:

1. Add an `ingredients: [{ sku, qtyPerUnit }]` mapping to each product in
   `script.js` (e.g. a Medium Latte uses 18g beans + 180ml milk).
2. In the `newOrderBtn`/checkout handler, after building the receipt, sum
   the ingredient quantities across the cart and `fetch('/api/consume', ...)`
   with that list and the order number.
3. Optionally poll `GET /api/alerts` on load and show a small banner in the
   POS UI if any HIGH-severity alerts are open (e.g. "Milk expiring today").

## How the two required functions work

**Usage rate** (`calculateUsageRate`): sums `consumption_log.quantity_used`
where `reason = 'sale'` over a trailing window (default 14 days) and divides
by the window length to get an average daily rate per product.

**Restock alert simulation** (`simulateRestockAlerts`): for every active
product it compares current stock (summed across active batches) against:
- the product's `reorder_point` → **LOW_STOCK**
- `current_stock / avg_daily_use` versus `lead_time_days + 1` day safety
  buffer → **STOCKOUT_PROJECTED** (stock will likely run out before a new
  order could arrive)
- each batch's `expires_at` versus an expiry threshold (default 3 days) →
  **EXPIRING_SOON**

Alerts are written to `restock_alerts`, skipping duplicates for anything
already open and unresolved, and returned as a list so a caller can act on
them immediately (e.g. push a notification).
