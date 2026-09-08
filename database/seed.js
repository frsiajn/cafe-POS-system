// seed.js — populates products, batches, and a few weeks of consumption
// history so calculateUsageRate() and simulateRestockAlerts() have
// something realistic to work with. Safe to re-run: wipes and rebuilds.

const { openDatabase } = require('./db');

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
function daysFromNow(n) {
  return daysAgo(-n);
}
function rand(min, max) { return Math.random() * (max - min) + min; }

function seed(db) {
  db.exec(`
    DELETE FROM restock_alerts;
    DELETE FROM consumption_log;
    DELETE FROM batches;
    DELETE FROM products;
    DELETE FROM sqlite_sequence WHERE name IN ('products','batches','consumption_log','restock_alerts');
  `);

  const insertProduct = db.prepare(`
    INSERT INTO products (sku, name, category, unit, reorder_point, reorder_qty, lead_time_days, default_shelf_life_days)
    VALUES (@sku, @name, @category, @unit, @reorder_point, @reorder_qty, @lead_time_days, @default_shelf_life_days)
  `);

  const products = [
    { sku: 'BEAN-ARB',  name: 'Arabica Coffee Beans', category: 'coffee_bean', unit: 'g',   reorder_point: 1500, reorder_qty: 5000, lead_time_days: 3, default_shelf_life_days: 30 },
    { sku: 'MILK-WHL',  name: 'Whole Milk',           category: 'dairy',       unit: 'ml',  reorder_point: 3000, reorder_qty: 8000, lead_time_days: 2, default_shelf_life_days: 7  },
    { sku: 'MILK-OAT',  name: 'Oat Milk',              category: 'dairy_alt',  unit: 'ml',  reorder_point: 2000, reorder_qty: 6000, lead_time_days: 2, default_shelf_life_days: 14 },
    { sku: 'FRUIT-BLU', name: 'Blueberries',           category: 'produce',    unit: 'g',   reorder_point: 500,  reorder_qty: 2000, lead_time_days: 2, default_shelf_life_days: 5  },
    { sku: 'DAIRY-BUT', name: 'Butter',                category: 'dairy',      unit: 'g',   reorder_point: 400,  reorder_qty: 1500, lead_time_days: 3, default_shelf_life_days: 21 },
    { sku: 'BAKE-FLR',  name: 'All-Purpose Flour',     category: 'dry_goods',  unit: 'g',   reorder_point: 2000, reorder_qty: 10000,lead_time_days: 4, default_shelf_life_days: 120},
    { sku: 'CHOC-CHP',  name: 'Chocolate Chips',       category: 'baking',     unit: 'g',   reorder_point: 600,  reorder_qty: 2000, lead_time_days: 3, default_shelf_life_days: 180},
    { sku: 'CUP-12OZ',  name: '12oz Paper Cups',       category: 'packaging',  unit: 'pcs', reorder_point: 100,  reorder_qty: 500,  lead_time_days: 5, default_shelf_life_days: 3650},
  ];
  const productIds = {};
  for (const p of products) {
    const info = insertProduct.run(p);
    productIds[p.sku] = info.lastInsertRowid;
  }

  const insertBatch = db.prepare(`
    INSERT INTO batches (product_id, batch_code, supplier, quantity_received, quantity_remaining, unit_cost, received_at, expires_at, status)
    VALUES (@product_id, @batch_code, @supplier, @quantity_received, @quantity_remaining, @unit_cost, @received_at, @expires_at, @status)
  `);

  // A couple of batches per product: an older one partially used, and a
  // fresher one. Blueberries and milk get a near-expiry batch on purpose
  // so the EXPIRING_SOON alert has something to catch.
  const batchPlan = [
    { sku: 'BEAN-ARB', code: 'BA-001', receivedDaysAgo: 20, shelfDays: 30, qty: 5000, remaining: 1200, cost: 0.9 },
    { sku: 'BEAN-ARB', code: 'BA-002', receivedDaysAgo: 2,  shelfDays: 30, qty: 5000, remaining: 4700, cost: 0.9 },

    { sku: 'MILK-WHL', code: 'MW-001', receivedDaysAgo: 6,  shelfDays: 7,  qty: 8000, remaining: 900,  cost: 0.06 }, // expiring soon
    { sku: 'MILK-WHL', code: 'MW-002', receivedDaysAgo: 1,  shelfDays: 7,  qty: 8000, remaining: 7600, cost: 0.06 },

    { sku: 'MILK-OAT', code: 'MO-001', receivedDaysAgo: 10, shelfDays: 14, qty: 6000, remaining: 1800, cost: 0.09 },
    { sku: 'MILK-OAT', code: 'MO-002', receivedDaysAgo: 3,  shelfDays: 14, qty: 6000, remaining: 5400, cost: 0.09 },

    { sku: 'FRUIT-BLU', code: 'FB-001', receivedDaysAgo: 4, shelfDays: 5,  qty: 2000, remaining: 350,  cost: 0.4 }, // expiring soon + low stock

    { sku: 'DAIRY-BUT', code: 'DB-001', receivedDaysAgo: 12, shelfDays: 21, qty: 1500, remaining: 380, cost: 0.15 }, // low stock

    { sku: 'BAKE-FLR', code: 'BF-001', receivedDaysAgo: 30, shelfDays: 120, qty: 10000, remaining: 6200, cost: 0.03 },

    { sku: 'CHOC-CHP', code: 'CC-001', receivedDaysAgo: 15, shelfDays: 180, qty: 2000, remaining: 1500, cost: 0.12 },

    { sku: 'CUP-12OZ', code: 'CP-001', receivedDaysAgo: 25, shelfDays: 3650, qty: 500, remaining: 80, cost: 0.05 }, // low stock, not perishable
  ];

  const batchIds = {};
  for (const b of batchPlan) {
    const received = daysAgo(b.receivedDaysAgo);
    const expires = daysFromNow(b.shelfDays - b.receivedDaysAgo);
    const info = insertBatch.run({
      product_id: productIds[b.sku],
      batch_code: b.code,
      supplier: 'Local Roastery & Distributors Co.',
      quantity_received: b.qty,
      quantity_remaining: b.remaining,
      unit_cost: b.cost,
      received_at: received,
      expires_at: expires,
      status: 'ACTIVE',
    });
    batchIds[b.code] = info.lastInsertRowid;
  }

  // --- Consumption history: 21 days of "sales" usage, roughly matching
  // a real café's daily rhythm, plus a little waste noise. ---
  const insertConsumption = db.prepare(`
    INSERT INTO consumption_log (product_id, batch_id, quantity_used, reason, order_ref, used_at)
    VALUES (@product_id, @batch_id, @quantity_used, @reason, @order_ref, @used_at)
  `);

  const dailyUsageBase = {
    'BEAN-ARB': 220,   // g/day
    'MILK-WHL': 950,   // ml/day
    'MILK-OAT': 480,   // ml/day
    'FRUIT-BLU': 140,  // g/day  -> pushes the small batch toward stockout
    'DAIRY-BUT': 35,   // g/day
    'BAKE-FLR': 260,   // g/day
    'CHOC-CHP': 30,    // g/day
    'CUP-12OZ': 45,    // pcs/day -> will exceed remaining cup stock quickly
  };
  const batchForSku = {
    'BEAN-ARB': 'BA-002', 'MILK-WHL': 'MW-002', 'MILK-OAT': 'MO-002',
    'FRUIT-BLU': 'FB-001', 'DAIRY-BUT': 'DB-001', 'BAKE-FLR': 'BF-001',
    'CHOC-CHP': 'CC-001', 'CUP-12OZ': 'CP-001',
  };

  for (let day = 21; day >= 1; day--) {
    const ts = daysAgo(day);
    for (const sku of Object.keys(dailyUsageBase)) {
      const base = dailyUsageBase[sku];
      const qty = Math.round(rand(base * 0.75, base * 1.25));
      insertConsumption.run({
        product_id: productIds[sku],
        batch_id: batchIds[batchForSku[sku]],
        quantity_used: qty,
        reason: 'sale',
        order_ref: `ORD-${1000 + day}`,
        used_at: ts,
      });
      // occasional waste entry
      if (Math.random() < 0.12) {
        insertConsumption.run({
          product_id: productIds[sku],
          batch_id: batchIds[batchForSku[sku]],
          quantity_used: Math.round(base * 0.05),
          reason: 'waste',
          order_ref: null,
          used_at: ts,
        });
      }
    }
  }

  console.log(`Seeded ${products.length} products, ${batchPlan.length} batches, ~21 days of consumption history.`);
}

if (require.main === module) {
  const db = openDatabase();
  seed(db);
  db.close();
}

module.exports = { seed };
