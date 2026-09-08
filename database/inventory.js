// inventory.js
//
// Backend functions for:
//   1. Calculating inventory usage rates from the consumption log
//   2. Simulating automated restocking alerts (low stock, projected
//      stockout, and batches nearing shelf-life expiry)
//
// Works against the schema in database/schema.sql via better-sqlite3.
// No framework assumed — call these functions from an Express route,
// a cron job, or a CLI script (see demo.js for a runnable example).

const SAFETY_BUFFER_DAYS = 1; // extra cushion added on top of supplier lead time

/**
 * Current total stock for a product, summed across its active batches.
 */
function getCurrentStock(db, productId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(quantity_remaining), 0) AS stock
    FROM batches
    WHERE product_id = ? AND status = 'ACTIVE'
  `).get(productId);
  return row.stock;
}

/**
 * Average daily usage rate for a product over a trailing window.
 * Only counts consumption logged with reason = 'sale', so waste/spoilage
 * doesn't inflate the rate used for restock planning.
 *
 * @param {Database} db
 * @param {number} productId
 * @param {number} windowDays - how many days back to look (default 14)
 * @returns {{ totalUsed:number, avgDailyUse:number, activeDays:number, windowDays:number }}
 */
function calculateUsageRate(db, productId, windowDays = 14) {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(quantity_used), 0) AS total_used,
      COUNT(DISTINCT date(used_at))   AS active_days
    FROM consumption_log
    WHERE product_id = ?
      AND reason = 'sale'
      AND used_at >= datetime('now', '-' || ? || ' days')
  `).get(productId, windowDays);

  return {
    totalUsed: row.total_used,
    avgDailyUse: Math.round((row.total_used / windowDays) * 100) / 100,
    activeDays: row.active_days,
    windowDays,
  };
}

/**
 * Usage rate for every active product in one pass (avoids N+1 queries
 * when the simulation runs across the whole catalog).
 */
function calculateUsageRatesForAllProducts(db, windowDays = 14) {
  const rows = db.prepare(`
    SELECT
      p.product_id,
      p.name,
      p.unit,
      COALESCE(SUM(c.quantity_used), 0) AS total_used
    FROM products p
    LEFT JOIN consumption_log c
      ON c.product_id = p.product_id
      AND c.reason = 'sale'
      AND c.used_at >= datetime('now', '-' || ? || ' days')
    WHERE p.is_active = 1
    GROUP BY p.product_id
  `).all(windowDays);

  return rows.map(r => ({
    productId: r.product_id,
    name: r.name,
    unit: r.unit,
    totalUsed: r.total_used,
    avgDailyUse: Math.round((r.total_used / windowDays) * 100) / 100,
  }));
}

/**
 * Batches for a product that will expire within `daysThreshold` days
 * (includes already-expired batches, which show a negative day count).
 */
function getExpiringBatches(db, productId, daysThreshold = 3) {
  return db.prepare(`
    SELECT batch_id, batch_code, quantity_remaining, expires_at,
           CAST(julianday(expires_at) - julianday('now') AS INTEGER) AS days_until_expiry
    FROM batches
    WHERE product_id = ?
      AND status = 'ACTIVE'
      AND quantity_remaining > 0
      AND julianday(expires_at) - julianday('now') <= ?
    ORDER BY expires_at ASC
  `).all(productId, daysThreshold);
}

/**
 * Inserts an alert row, but skips it if an unresolved alert of the same
 * type already exists for that product (keeps the alert table from
 * filling up with duplicates every time the simulation runs).
 */
function raiseAlertIfNew(db, { productId, batchId = null, alertType, severity, message, suggestedQty = null }) {
  const existing = db.prepare(`
    SELECT alert_id FROM restock_alerts
    WHERE product_id = ? AND alert_type = ? AND resolved = 0
      AND (batch_id IS ? OR batch_id = ?)
  `).get(productId, alertType, batchId, batchId);

  if (existing) return null;

  const result = db.prepare(`
    INSERT INTO restock_alerts (product_id, batch_id, alert_type, severity, message, suggested_qty)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(productId, batchId, alertType, severity, message, suggestedQty);

  return result.lastInsertRowid;
}

/**
 * Runs the full restock simulation across all active products:
 *  - LOW_STOCK: stock has already dropped to/below the reorder point
 *  - STOCKOUT_PROJECTED: at the current usage rate, stock will run out
 *    before a new order could arrive (lead time + safety buffer)
 *  - EXPIRING_SOON: a batch will expire within its product's shelf-life
 *    threshold window, regardless of stockout risk
 *
 * Alerts are persisted to restock_alerts and also returned as an array
 * so a caller (API route, cron job, CLI) can act on them immediately.
 *
 * @param {Database} db
 * @param {object} options
 * @param {number} options.usageWindowDays - lookback window for usage rate (default 14)
 * @param {number} options.expiryThresholdDays - "expiring soon" window (default 3)
 */
function simulateRestockAlerts(db, options = {}) {
  const usageWindowDays = options.usageWindowDays ?? 14;
  const expiryThresholdDays = options.expiryThresholdDays ?? 3;

  const products = db.prepare(`SELECT * FROM products WHERE is_active = 1`).all();
  const generatedAlerts = [];

  for (const product of products) {
    const currentStock = getCurrentStock(db, product.product_id);
    const usage = calculateUsageRate(db, product.product_id, usageWindowDays);
    const daysOfSupply = usage.avgDailyUse > 0
      ? Math.round((currentStock / usage.avgDailyUse) * 10) / 10
      : null; // no recent usage — can't project a stockout date

    // --- LOW_STOCK: already at/under the reorder point ---
    if (currentStock <= product.reorder_point) {
      const id = raiseAlertIfNew(db, {
        productId: product.product_id,
        alertType: 'LOW_STOCK',
        severity: currentStock <= 0 ? 'HIGH' : 'MEDIUM',
        message: `${product.name}: ${currentStock} ${product.unit} left (reorder point ${product.reorder_point} ${product.unit}).`,
        suggestedQty: product.reorder_qty,
      });
      if (id) generatedAlerts.push({ id, productId: product.product_id, product: product.name, alertType: 'LOW_STOCK', daysOfSupply, currentStock });
    }

    // --- STOCKOUT_PROJECTED: usage rate implies running dry before restock arrives ---
    const coverageNeeded = product.lead_time_days + SAFETY_BUFFER_DAYS;
    if (daysOfSupply !== null && daysOfSupply < coverageNeeded && currentStock > product.reorder_point) {
      const id = raiseAlertIfNew(db, {
        productId: product.product_id,
        alertType: 'STOCKOUT_PROJECTED',
        severity: daysOfSupply <= 1 ? 'HIGH' : 'MEDIUM',
        message: `${product.name}: at ${usage.avgDailyUse} ${product.unit}/day, only ${daysOfSupply} day(s) of stock remain — less than the ${coverageNeeded}-day supplier lead time.`,
        suggestedQty: product.reorder_qty,
      });
      if (id) generatedAlerts.push({ id, productId: product.product_id, product: product.name, alertType: 'STOCKOUT_PROJECTED', daysOfSupply, currentStock });
    }

    // --- EXPIRING_SOON: batch-level shelf-life check ---
    const expiring = getExpiringBatches(db, product.product_id, expiryThresholdDays);
    for (const batch of expiring) {
      const id = raiseAlertIfNew(db, {
        productId: product.product_id,
        batchId: batch.batch_id,
        alertType: 'EXPIRING_SOON',
        severity: batch.days_until_expiry <= 0 ? 'HIGH' : 'LOW',
        message: batch.days_until_expiry <= 0
          ? `${product.name} batch ${batch.batch_code} has expired (${batch.quantity_remaining} ${product.unit} remaining) — pull from shelf.`
          : `${product.name} batch ${batch.batch_code} expires in ${batch.days_until_expiry} day(s) (${batch.quantity_remaining} ${product.unit} remaining).`,
      });
      if (id) generatedAlerts.push({ id, productId: product.product_id, product: product.name, alertType: 'EXPIRING_SOON', batchCode: batch.batch_code, daysUntilExpiry: batch.days_until_expiry });
    }
  }

  return generatedAlerts;
}

module.exports = {
  getCurrentStock,
  calculateUsageRate,
  calculateUsageRatesForAllProducts,
  getExpiringBatches,
  simulateRestockAlerts,
};
