import assert from 'node:assert/strict';
import test from 'node:test';

import { MetaMarketingClient } from '../src/meta.mjs';

function response(body, status = 200, headers = {}) {
    return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body };
}

test('Meta client uses bearer auth, pinned version and paginates read-only', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).includes('/act_123?')) return response({ currency: 'USD', timezone_name: 'America/Argentina/Buenos_Aires' });
        if (String(url).includes('/campaigns') && !String(url).includes('after=')) return response({ data: [{ id: 'c1', name: 'Campaign', status: 'ACTIVE', effective_status: 'ACTIVE', objective: 'OUTCOME_TRAFFIC' }], paging: { next: 'https://graph.facebook.com/v25.0/act_123/campaigns?after=next' } });
        if (String(url).includes('/campaigns')) return response({ data: [] });
        return response({ data: [] });
    };
    const client = new MetaMarketingClient({ token: 'private', accountId: 'act_123', fetchImpl });
    const rows = await client.entities(new Date('2026-08-29T00:00:00Z'));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].configuredStatus, 'ACTIVE');
    assert.ok(calls.every(call => call.url.startsWith('https://graph.facebook.com/v25.0/')));
    assert.ok(calls.every(call => call.init.headers.authorization === 'Bearer private'));
    assert.ok(calls.every(call => call.init.method === undefined));
});

test('Meta client retries rate limits with bounded backoff', async () => {
    let calls = 0;
    const waits = [];
    const client = new MetaMarketingClient({
        token: 'private', accountId: '123',
        fetchImpl: async () => { calls += 1; return calls === 1 ? response({}, 429, { 'retry-after': '2' }) : response({ data: [] }); },
        sleepImpl: async ms => waits.push(ms),
    });
    await client.pages('act_123/campaigns', { fields: 'id' });
    assert.equal(calls, 2);
    assert.deepEqual(waits, [2000]);
});

test('Meta pagination rejects a URL outside the pinned Graph origin', async () => {
    const client = new MetaMarketingClient({
        token: 'private', accountId: '123',
        fetchImpl: async () => response({ data: [], paging: { next: 'https://evil.example/token' } }),
    });
    await assert.rejects(client.pages('act_123/campaigns', { fields: 'id' }), /unsafe_pagination_url/);
});
