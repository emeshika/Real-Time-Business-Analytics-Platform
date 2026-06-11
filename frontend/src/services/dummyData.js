/**
 * dummyData.js
 * ------------
 * Realistic seed data so the dashboard looks great even without
 * the backend running. Mirrors the exact shapes returned by the API.
 */

// ── Helpers ────────────────────────────────────────────────────
const rand = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ── Hourly metrics (last 24 hours) ────────────────────────────
export function generateHourlyMetrics(n = 24) {
  const now = new Date();
  const metrics = [];
  for (let i = n - 1; i >= 0; i--) {
    const ts = new Date(now);
    ts.setHours(ts.getHours() - i, 0, 0, 0);
    const txns = randInt(18, 75);
    const totalCost = txns * rand(120, 280);
    metrics.push({
      hour_start: ts.toISOString(),
      total_transactions: txns,
      total_cost: parseFloat(totalCost.toFixed(2)),
      avg_discount: parseFloat(rand(5, 30).toFixed(2)),
      avg_rating: parseFloat(rand(2.8, 5.0).toFixed(2)),
      on_time_rate: parseFloat(rand(0.55, 0.85).toFixed(4)),
      on_time_sum: randInt(10, 55),
      total_weight: parseFloat((txns * rand(2000, 5000)).toFixed(2)),
      shipment_mode_counts: { Ship: randInt(5, 30), Flight: randInt(3, 20), Road: randInt(2, 15) },
      warehouse_block_counts: {
        A: randInt(3, 18), B: randInt(3, 18), C: randInt(3, 15),
        D: randInt(2, 12), F: randInt(2, 10),
      },
    });
  }
  return metrics;
}

// ── Daily metrics (last 7 days) ────────────────────────────────
export function generateDailyMetrics(n = 7) {
  const now = new Date();
  const metrics = [];
  for (let i = n - 1; i >= 0; i--) {
    const ts = new Date(now);
    ts.setDate(ts.getDate() - i);
    ts.setHours(0, 0, 0, 0);
    const txns = randInt(300, 900);
    metrics.push({
      date_start: ts.toISOString(),
      total_transactions: txns,
      total_cost: parseFloat((txns * rand(130, 260)).toFixed(2)),
      avg_discount: parseFloat(rand(8, 25).toFixed(2)),
      avg_rating: parseFloat(rand(3.0, 4.8).toFixed(2)),
      on_time_rate: parseFloat(rand(0.6, 0.82).toFixed(4)),
      total_weight: parseFloat((txns * rand(2500, 4500)).toFixed(2)),
    });
  }
  return metrics;
}

// ── Recent transactions ────────────────────────────────────────
const SHIPMENT_MODES = ['Ship', 'Flight', 'Road'];
const WAREHOUSE_BLOCKS = ['A', 'B', 'C', 'D', 'F'];
const IMPORTANCES = ['Low', 'Medium', 'High'];

export function generateTransactions(n = 20) {
  return Array.from({ length: n }, (_, idx) => ({
    id: 10000 + idx,
    warehouse_block: choice(WAREHOUSE_BLOCKS),
    mode_of_shipment: choice(SHIPMENT_MODES),
    customer_care_calls: randInt(1, 7),
    customer_rating: randInt(1, 5),
    cost_of_product: parseFloat(rand(80, 350).toFixed(2)),
    prior_purchases: randInt(2, 8),
    product_importance: choice(IMPORTANCES),
    gender: choice(['M', 'F']),
    discount_offered: parseFloat(rand(0, 65).toFixed(2)),
    weight_in_gms: parseFloat(rand(1000, 7000).toFixed(0)),
    reached_on_time: randInt(0, 1),
    timestamp: new Date(Date.now() - idx * 4000).toISOString(),
  }));
}

// ── ML Predictions ─────────────────────────────────────────────
export function generatePredictions(n = 8) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => ({
    predicted_total_cost_next_hour: parseFloat(rand(3000, 18000).toFixed(2)),
    prediction_time: new Date(now - i * 30 * 60 * 1000).toISOString(),
    based_on_latest_hour: new Date(now - (i + 1) * 60 * 60 * 1000).toISOString(),
    records_used: randInt(6, 10),
    model_version: 'xgboost_v1',
    status: 'ok',
  }));
}

// ── Aggregate KPIs from hourly data ───────────────────────────
export function computeKPIs(hourlyMetrics) {
  if (!hourlyMetrics?.length) {
    return { totalRevenue: 0, totalOrders: 0, avgRating: 0, onTimeRate: 0 };
  }
  const totalRevenue = hourlyMetrics.reduce((s, h) => s + (h.total_cost || 0), 0);
  const totalOrders  = hourlyMetrics.reduce((s, h) => s + (h.total_transactions || 0), 0);
  const avgRating    = hourlyMetrics.reduce((s, h) => s + (h.avg_rating || 0), 0) / hourlyMetrics.length;
  const onTimeRate   = hourlyMetrics.reduce((s, h) => s + (h.on_time_rate || 0), 0) / hourlyMetrics.length;
  return {
    totalRevenue: parseFloat(totalRevenue.toFixed(2)),
    totalOrders,
    avgRating:   parseFloat(avgRating.toFixed(2)),
    onTimeRate:  parseFloat((onTimeRate * 100).toFixed(1)),
  };
}
