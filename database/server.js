// server.js — small REST layer so the (static) POS frontend can read
// inventory/alerts and log consumption when a sale is checked out.
//
// Run with: node backend/server.js
// Then e.g. GET http://localhost:3001/api/inventory

const express = require('express');
const { openDatabase } = require('./db');
const { calculateUsageRatesForAllProducts, simulateRestockAlerts } = require('./inventory');

const app = express();
app.use(express.json());

// Allow the static POS front end (opened from a different origin/file)
// to call this API during development.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

const db = openDatabase();

// GET /api/inventory — current stock per product
app.get('/api/inventory', (req, res) => {
  const rows = db.prepare(`
    SELECT p.product_id, p.sku, p.name, p.unit,
           COALESCE(SUM(b.quantity_remaining), 0) AS current_stock,
           p.reorder_point
    FROM products p
    LEFT JOIN batches b ON b.product_id = p.product_id AND b.status = 'ACTIVE'
    WHERE p.is_active = 1
    GROUP BY p.product_id
    ORDER BY p.name
  `).all();
  res.json(rows);
});

// GET /api/usage/:sku?days=14 — usage rate for one product
app.get('/api/usage/:sku', (req, res) => {
  const product = db.prepare(`SELECT * FROM products WHERE sku = ?`).get(req.params.sku);
  if (!product) return res.status(404).json({ error: 'Unknown SKU' });

  const { calculateUsageRate } = require('./inventory');
  const days = Number(req.query.days) || 14;
  res.json({ product: product.name, ...calculateUsageRate(db, product.product_id, days) });
});

// GET /api/alerts — unresolved alerts, most severe first
app.get('/api/alerts', (req, res) => {
  const rows = db.prepare(`
    SELECT a.alert_id, p.name AS product, a.alert_type, a.severity, a.message, a.created_at
    FROM restock_alerts a JOIN products p ON p.product_id = a.product_id
    WHERE a.resolved = 0
    ORDER BY CASE a.severity WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, a.created_at DESC
  `).all();
  res.json(rows);
});

// POST /api/simulate — re-run the restock simulation on demand
app.post('/api/simulate', (req, res) => {
  const alerts = simulateRestockAlerts(db, req.body || {});
  res.json({ newAlerts: alerts.length, alerts });
});

// POST /api/consume — log ingredient usage from a checked-out POS order
// Body: { orderRef: "00125", items: [{ sku: "MILK-WHL", qty: 180 }, ...] }
app.post('/api/consume', (req, res) => {
  const { orderRef, items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items[] required' });
  }

  const findBatch = db.prepare(`
    SELECT batch_id FROM batches
    WHERE product_id = ? AND status = 'ACTIVE' AND quantity_remaining > 0
    ORDER BY expires_at ASC LIMIT 1
  `);
  const findProduct = db.prepare(`SELECT product_id FROM products WHERE sku = ?`);
  const decrementBatch = db.prepare(`UPDATE batches SET quantity_remaining = quantity_remaining - ? WHERE batch_id = ?`);
  const insertLog = db.prepare(`
    INSERT INTO consumption_log (product_id, batch_id, quantity_used, reason, order_ref)
    VALUES (?, ?, ?, 'sale', ?)
  `);

  const applied = [];
  const txn = db.transaction((items) => {
    for (const item of items) {
      const product = findProduct.get(item.sku);
      if (!product) continue; // unknown ingredient SKU — skip rather than fail the whole order
      const batch = findBatch.get(product.product_id);
      if (batch) decrementBatch.run(item.qty, batch.batch_id);
      insertLog.run(product.product_id, batch ? batch.batch_id : null, item.qty, orderRef || null);
      applied.push(item.sku);
    }
  });
  txn(items);

  res.json({ ok: true, applied });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Inventory API listening on http://localhost:${PORT}`));
