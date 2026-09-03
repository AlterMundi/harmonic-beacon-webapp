import assert from 'node:assert/strict';
import test from 'node:test';

import { dashboardFilters, queryDashboard } from '../src/dashboard.mjs';

test('calendar ranges include the selected final day in the chosen timezone', () => {
    const filters = dashboardFilters({
        start: '2026-09-03', end: '2026-09-03',
        timezone: 'America/Argentina/Cordoba', traffic: ['real'],
    });
    assert.equal(filters.start.toISOString(), '2026-09-03T03:00:00.000Z');
    assert.equal(filters.end.toISOString(), '2026-09-04T03:00:00.000Z');
    assert.equal(filters.startDay, '2026-09-03');
    assert.equal(filters.endDay, '2026-09-03');
});

test('calendar boundaries honor 23-hour and 25-hour DST days', () => {
    const spring = dashboardFilters({
        start: '2026-03-08', end: '2026-03-08', timezone: 'America/New_York', traffic: ['real'],
    });
    assert.equal(spring.start.toISOString(), '2026-03-08T05:00:00.000Z');
    assert.equal(spring.end.toISOString(), '2026-03-09T04:00:00.000Z');
    assert.equal(spring.end - spring.start, 23 * 60 * 60 * 1000);

    const fall = dashboardFilters({
        start: '2026-11-01', end: '2026-11-01', timezone: 'America/New_York', traffic: ['real'],
    });
    assert.equal(fall.start.toISOString(), '2026-11-01T04:00:00.000Z');
    assert.equal(fall.end.toISOString(), '2026-11-02T05:00:00.000Z');
    assert.equal(fall.end - fall.start, 25 * 60 * 60 * 1000);
});

test('calendar range validation rejects impossible, reversed and oversized selections', () => {
    assert.throws(() => dashboardFilters({ start: '2026-02-30', end: '2026-03-01', timezone: 'UTC', traffic: ['real'] }), /invalid_date_range/);
    assert.throws(() => dashboardFilters({ start: '2026-09-04', end: '2026-09-03', timezone: 'UTC', traffic: ['real'] }), /invalid_date_range/);
    assert.throws(() => dashboardFilters({ start: '2024-01-01', end: '2026-01-02', timezone: 'UTC', traffic: ['real'] }), /invalid_date_range/);
    assert.throws(() => dashboardFilters({ start: '2026-09-03', end: '2026-09-03', timezone: 'Mars/Olympus', traffic: ['real'] }), /invalid_timezone/);
    assert.throws(() => dashboardFilters({ start: '2026-09-03', end: '2026-09-03', timezone: 'x'.repeat(65), traffic: ['real'] }), /invalid_timezone/);
});

test('dashboard SQL receives zoned boundaries and explicit retained UTC day labels', async () => {
    const calls = [];
    const pool = {
        query: async (sql, params = []) => {
            calls.push({ sql, params });
            return { rows: [] };
        },
    };
    const result = await queryDashboard(pool, {
        start: '2026-03-08', end: '2026-03-08',
        timezone: 'America/New_York', environment: 'production', traffic: ['real'],
    });
    assert.equal(result.filters.start, '2026-03-08T05:00:00.000Z');
    assert.equal(result.filters.end, '2026-03-09T04:00:00.000Z');
    assert.equal(result.filters.startDay, '2026-03-08');
    assert.equal(result.filters.endDay, '2026-03-08');
    assert.ok(calls.some(call => call.sql.includes('mart.campaign_delivery') && call.sql.includes('date_start <= $2::date')));
    assert.ok(calls.some(call => call.sql.includes('cohort_date') && call.sql.includes('started_at at time zone $5')));
    assert.ok(calls.some(call => call.sql.includes('mart.daily_metrics') && call.sql.includes('metric_date <= $4::date')));
    assert.ok(calls.some(call => call.sql.includes('mart.acquisition') && call.sql.includes('metric_date <= $4::date')));
});
