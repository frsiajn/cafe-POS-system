// demo.js — run with: node backend/demo.js
// Seeds sample data, then demonstrates both required backend functions.

const { openDatabase } = require('./db');
const { seed } = require('./seed');
const {
  calculateUsageRatesForAllProducts,
  simulateRestockAlerts,
} = require('./inventory');

const db = openDatabase();
seed(db);

console.log('\n--- Usage rates (last 14 days) ---');
console.table(
  calculateUsageRatesForAllProducts(db, 14).map(r => ({
    product: r.name,
    unit: r.unit,
    total_used_14d: r.totalUsed,
    avg_daily_use: r.avgDailyUse,
  }))
);

console.log('\n--- Simulated restock alerts ---');
const alerts = simulateRestockAlerts(db, { usageWindowDays: 14, expiryThresholdDays: 3 });

if (alerts.length === 0) {
  console.log('No alerts triggered.');
} else {
  console.table(
    alerts.map(a => ({
      product: a.product,
      type: a.alertType,
      days_of_supply: a.daysOfSupply ?? '—',
      batch: a.batchCode ?? '—',
      days_until_expiry: a.daysUntilExpiry ?? '—',
    }))
  );
}

console.log('\n--- All unresolved alerts currently stored in restock_alerts ---');
console.table(
  db.prepare(`
    SELECT p.name AS product, a.alert_type, a.severity, a.message
    FROM restock_alerts a JOIN products p ON p.product_id = a.product_id
    WHERE a.resolved = 0
    ORDER BY CASE a.severity WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END
  `).all()
);

db.close();
