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
    assert.match(tracker, /SESSION_IDLE_MS = 1800000/);
    assert.match(tracker, /handoffSessionId === session\.id/);
    assert.match(tracker, /Date\.now\(\) < handoffExpiresAt/);
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
    assert.match(source, /PAYMENT_REFUNDED','DISPUTED/);
    assert.match(source, /'confirmed'.*'refunded'.*'reversed'/s);
    assert.match(source, /\$5::timestamptz/);
    assert.match(source, /durationMs > 12 \* 60 \* 60 \* 1000/);
    assert.match(source, /recordFailure/);
    assert.match(source, /resolveFailures/);
});

test('browser retention preserves daily acquisition aggregates beyond raw-event expiry', async () => {
    const worker = await readFile(new URL('src/worker.mjs', root), 'utf8');
    assert.match(worker, /refreshDaily\(180\)/);
    assert.match(worker, /refreshDaily\(2\)/);
    assert.match(worker, /insert into mart\.acquisition_daily/);
    assert.match(worker, /delete from ingest\.raw_events where received_at < now\(\)-interval '180 days'/);
});

test('Compose starts the analytics worker entrypoint rather than the collector server', async () => {
    const compose = await readFile(new URL('../../ops/analytics/compose.yml', root), 'utf8');
    assert.match(compose, /worker:[\s\S]*command: \["node", "src\/worker\.mjs"\]/);
});

test('backup verification uses the pinned PostgreSQL toolchain and mounted data disk', async () => {
    const backup = await readFile(new URL('../../ops/analytics/backup-analytics.sh', root), 'utf8');
    const restore = await readFile(new URL('../../ops/analytics/restore-verify-analytics.sh', root), 'utf8');
    for (const script of [backup, restore]) {
        assert.match(script, /mountpoint -q/);
        assert.match(script, /postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777/);
        assert.match(script, /docker run --rm -i "\$postgres_image" pg_restore --list/);
        assert.doesNotMatch(script, /^pg_restore /m);
    }
});
