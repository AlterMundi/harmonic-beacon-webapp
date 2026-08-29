import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('tracker is fail-open and does not inspect form values or Meta Pixel', async () => {
    const tracker = await readFile(new URL('src/tracker.js', root), 'utf8');
    assert.match(tracker, /sendBeacon/);
    assert.match(tracker, /\.catch\(\(\) => \{\}\)/);
    assert.doesNotMatch(tracker, /FormData|target\.value|currentTarget\.value|meta-pixel|fbq/);
    assert.match(tracker, /history\.replaceState/);
});

test('schema has closed top-level fields and canonical version', async () => {
    const schema = JSON.parse(await readFile(new URL('../../contracts/analytics/v1/event.schema.json', root), 'utf8'));
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.schema_version.const, 'hb.analytics.event.v1');
    assert.equal(schema.properties.properties.maxProperties, 32);
});

test('SQL mart unions overlapping intervals before calculating duration', async () => {
    const sql = await readFile(new URL('migrations/002_union_and_dashboard_views.sql', root), 'utf8');
    assert.match(sql, /max\(ended_at\).*UNBOUNDED PRECEDING AND 1 PRECEDING/s);
    assert.match(sql, /listening_intervals_unioned/);
    assert.match(sql, /live_presence_intervals_unioned/);
    assert.match(sql, /not is_staff and not is_test|is_staff/);
});

test('source backfills exclude unverifiable legacy lease time from real metrics', async () => {
    const source = await readFile(new URL('src/sources.mjs', root), 'utf8');
    assert.match(source, /row\.presence !== 'LISTENING'/);
    assert.match(source, /'listener-lease-backfill'.*'unknown'/s);
    assert.match(source, /\.\.\.durableIntervals\.rows/);
    assert.match(source, /\.\.\.payments\.rows/);
});
