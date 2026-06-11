/**
 * api.js
 * ------
 * Axios-based REST client for the PulseBI FastAPI backend.
 * Base URL: http://localhost:8000
 */

import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 8000,
  headers: { 'Content-Type': 'application/json' },
});

// ── Response interceptor (graceful error logging) ─────────────
client.interceptors.response.use(
  (res) => res,
  (err) => {
    console.warn('[PulseBI API] Request failed:', err.message);
    return Promise.reject(err);
  }
);

// ── Health check ──────────────────────────────────────────────
export const fetchHealth = () => client.get('/api/health').then((r) => r.data);

// ── Historical transactions ───────────────────────────────────
export const fetchHistoricalData = (limit = 50) =>
  client.get('/api/historical-data', { params: { limit } }).then((r) => r.data);

// ── Hourly aggregated metrics ─────────────────────────────────
export const fetchHourlyMetrics = (limit = 24) =>
  client.get('/api/hourly-metrics', { params: { limit } }).then((r) => r.data);

// ── Daily aggregated metrics ──────────────────────────────────
export const fetchDailyMetrics = (limit = 30) =>
  client.get('/api/daily-metrics', { params: { limit } }).then((r) => r.data);

// ── ML Predictions ────────────────────────────────────────────
export const fetchPredictions = (limit = 10) =>
  client.get('/api/predictions/', { params: { limit } }).then((r) => r.data);

export const fetchLatestPrediction = () =>
  client.get('/api/predictions/latest').then((r) => r.data);

export default client;
