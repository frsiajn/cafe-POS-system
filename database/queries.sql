-- ============================================================
-- Bloom & Brew — Inventory Tracking Queries
-- ============================================================

-- ------------------------------------------------------------
-- A. CURRENT INVENTORY (per product, summed across active batches)
-- ------------------------------------------------------------
SELECT
    p.product_id,
    p.sku,
    p.name,
    p.category,
    p.unit,
    COALESCE(SUM(b.quantity_remaining), 0)   AS current_stock,
    p.reorder_point,
    CASE WHEN COALESCE(SUM(b.quantity_remaining), 0) <= p.reorder_point
         THEN 1 ELSE 0 END                    AS below_reorder_point
FROM products p
LEFT JOIN batches b
    ON b.product_id = p.product_id
    AND b.status = 'ACTIVE'
WHERE p.is_active = 1
GROUP BY p.product_id
ORDER BY below_reorder_point DESC, current_stock ASC;


-- ------------------------------------------------------------
-- B. BATCH-LEVEL SHELF LIFE — batches expiring within N days
-- (bind :days_threshold, e.g. 3)
-- ------------------------------------------------------------
SELECT
    b.batch_id,
    b.batch_code,
    p.name                                    AS product_name,
    p.unit,
    b.quantity_remaining,
    b.received_at,
    b.expires_at,
    CAST(julianday(b.expires_at) - julianday('now') AS INTEGER) AS days_until_expiry
FROM batches b
JOIN products p ON p.product_id = b.product_id
WHERE b.status = 'ACTIVE'
    AND b.quantity_remaining > 0
    AND julianday(b.expires_at) - julianday('now') <= :days_threshold
ORDER BY b.expires_at ASC;


-- ------------------------------------------------------------
-- C. ALREADY-EXPIRED, UNRESOLVED BATCHES (should be pulled/discarded)
-- ------------------------------------------------------------
SELECT b.batch_id, p.name AS product_name, b.batch_code,
       b.quantity_remaining, b.expires_at
FROM batches b
JOIN products p ON p.product_id = b.product_id
WHERE b.status = 'ACTIVE'
    AND b.quantity_remaining > 0
    AND julianday(b.expires_at) < julianday('now')
ORDER BY b.expires_at ASC;


-- ------------------------------------------------------------
-- D. CONSUMPTION PATTERNS — total usage per product, last N days
-- (bind :window_days, e.g. 14)
-- ------------------------------------------------------------
SELECT
    p.product_id,
    p.name,
    p.unit,
    SUM(c.quantity_used)                                   AS total_used,
    ROUND(SUM(c.quantity_used) * 1.0 / :window_days, 2)    AS avg_daily_use,
    COUNT(DISTINCT date(c.used_at))                        AS active_days
FROM consumption_log c
JOIN products p ON p.product_id = c.product_id
WHERE c.used_at >= datetime('now', '-' || :window_days || ' days')
    AND c.reason = 'sale'
GROUP BY p.product_id
ORDER BY total_used DESC;


-- ------------------------------------------------------------
-- E. CONSUMPTION TREND — this week vs. previous week, per product
-- (week-over-week change signals accelerating/slowing usage)
-- ------------------------------------------------------------
SELECT
    p.product_id,
    p.name,
    SUM(CASE WHEN c.used_at >= datetime('now','-7 days') THEN c.quantity_used ELSE 0 END) AS this_week,
    SUM(CASE WHEN c.used_at >= datetime('now','-14 days') AND c.used_at < datetime('now','-7 days')
             THEN c.quantity_used ELSE 0 END)                                             AS prior_week,
    ROUND(
        (SUM(CASE WHEN c.used_at >= datetime('now','-7 days') THEN c.quantity_used ELSE 0 END)
        - SUM(CASE WHEN c.used_at >= datetime('now','-14 days') AND c.used_at < datetime('now','-7 days')
                   THEN c.quantity_used ELSE 0 END))
        * 100.0 /
        NULLIF(SUM(CASE WHEN c.used_at >= datetime('now','-14 days') AND c.used_at < datetime('now','-7 days')
                        THEN c.quantity_used ELSE 0 END), 0)
    , 1)                                                                                  AS pct_change_wow
FROM products p
LEFT JOIN consumption_log c ON c.product_id = p.product_id AND c.reason = 'sale'
GROUP BY p.product_id
ORDER BY this_week DESC;


-- ------------------------------------------------------------
-- F. WASTE / SPOILAGE RATE — how much of what's consumed is lost, not sold
-- ------------------------------------------------------------
SELECT
    p.product_id,
    p.name,
    SUM(CASE WHEN c.reason = 'sale' THEN c.quantity_used ELSE 0 END)                AS sold_qty,
    SUM(CASE WHEN c.reason IN ('waste','spoilage') THEN c.quantity_used ELSE 0 END) AS wasted_qty,
    ROUND(
        SUM(CASE WHEN c.reason IN ('waste','spoilage') THEN c.quantity_used ELSE 0 END) * 100.0
        / NULLIF(SUM(c.quantity_used), 0)
    , 1) AS waste_pct
FROM consumption_log c
JOIN products p ON p.product_id = c.product_id
WHERE c.used_at >= datetime('now', '-30 days')
GROUP BY p.product_id
HAVING wasted_qty > 0
ORDER BY waste_pct DESC;


-- ------------------------------------------------------------
-- G. FIFO SUGGESTION — which batch should be drawn from next for a product
-- (oldest expires_at first, among batches with stock remaining)
-- ------------------------------------------------------------
SELECT batch_id, batch_code, quantity_remaining, expires_at
FROM batches
WHERE product_id = :product_id
    AND status = 'ACTIVE'
    AND quantity_remaining > 0
ORDER BY expires_at ASC
LIMIT 1;


-- ------------------------------------------------------------
-- H. OPEN (UNRESOLVED) ALERTS, most severe first
-- ------------------------------------------------------------
SELECT a.alert_id, p.name AS product_name, a.alert_type, a.severity,
       a.message, a.suggested_qty, a.created_at
FROM restock_alerts a
JOIN products p ON p.product_id = a.product_id
WHERE a.resolved = 0
ORDER BY
    CASE a.severity WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
    a.created_at DESC;
