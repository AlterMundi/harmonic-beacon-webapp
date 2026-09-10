import { createHash, createHmac } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Test the external identity simulation over actual HTTP. No app authorization
// module is mocked. Browser/RP integration is a separate, explicit gate.
test('external identity simulation rejects incorrect credentials, enforces PKCE and single-use codes', async () => {
    const { startAccountFixture } = await import('./protocol');
    const service = await startAccountFixture({ port: 0, liveOrigin: 'https://localhost:3410' });
    try {
        const discovery = await (await fetch(`${service.issuer}/.well-known/openid-configuration`)).json();
        assert.equal(discovery.issuer, service.issuer);
        const verifier = 'fixture-verifier-with-at-least-forty-three-characters';
        const url = new URL(discovery.authorization_endpoint);
        url.search = new URLSearchParams({ response_type: 'code', scope: 'openid profile', client_id: service.clientId,
            redirect_uri: 'https://localhost:3410/api/account/callback', nonce: 'test-nonce', state: 'test-state',
            code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') }).toString();
        const start = await fetch(url);
        const html = await start.text();
        const request = /name="request" value="([^"]+)"/.exec(html)![1];
        const authorize = (password: string) => fetch(url.origin + '/authorize', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ request, username: 'attendee', password }) });
        assert.equal((await authorize('wrong')).status, 401);
        const login = await authorize(service.userPassword);
        assert.equal(login.status, 303);
        const callback = new URL(login.headers.get('location')!);
        assert.equal(callback.searchParams.get('state'), 'test-state');
        const code = callback.searchParams.get('code')!;
        const exchange = (secret: string, proof = verifier) => fetch(discovery.token_endpoint, { method: 'POST',
            headers: { authorization: `Basic ${Buffer.from(`${service.clientId}:${secret}`).toString('base64')}` },
            body: new URLSearchParams({ code, code_verifier: proof, grant_type: 'authorization_code', redirect_uri: 'https://localhost:3410/api/account/callback' }) });
        assert.equal((await exchange('wrong')).status, 401);
        assert.equal((await exchange(service.clientSecret, 'wrong')).status, 400);
        const token = await exchange(service.clientSecret);
        assert.equal(token.status, 200);
        const tokens = await token.json();
        assert.ok(tokens.id_token);
        const { payload } = await jwtVerify(tokens.id_token, createRemoteJWKSet(new URL(discovery.jwks_uri)), { issuer: service.issuer, audience: service.clientId, algorithms: ['ES256'], requiredClaims: ['iat', 'exp', 'sub', 'sid', 'nonce'] });
        assert.equal(payload.nonce, 'test-nonce');
        assert.equal((await exchange(service.clientSecret)).status, 400);
        const basic = `Basic ${Buffer.from(`${service.clientId}:${service.clientSecret}`).toString('base64')}`;
        const introspect = await fetch(discovery.introspection_endpoint, { method: 'POST', headers: { authorization: basic }, body: new URLSearchParams({ token: tokens.access_token }) });
        assert.deepEqual(await introspect.json(), { active: true, client_id: service.clientId, sub: 'fixture-attendee' });
        assert.equal((await fetch(discovery.userinfo_endpoint)).status, 401);
        assert.equal((await fetch(discovery.userinfo_endpoint, { headers: { authorization: `Bearer ${tokens.access_token}` } })).status, 200);
        const status = (sub = 'fixture-attendee', authorization = basic) => fetch(`${service.issuer}/api/account/session-status`, { method: 'POST', headers: { authorization }, body: new URLSearchParams({ sid: String(payload.sid), sub }) });
        assert.equal((await status('fixture-attendee', 'Basic wrong')).status, 401);
        assert.deepEqual(await (await status('different')).json(), { active: false });
        assert.equal((await status()).headers.get('cache-control'), 'no-store');
        assert.equal((await (await status()).json()).active, true);
        const now = Math.floor(Date.now() / 1000);
        const encoded = Buffer.from(JSON.stringify({ v: 1, iss: service.issuer, client_id: service.clientId, sid: payload.sid, mode: 'current', return_to: 'https://localhost:3410/', state: 'unique-logout-state', iat: now, exp: now + 120 })).toString('base64url');
        const initiation = `${encoded}.${createHmac('sha256', service.clientSecret).update(encoded).digest('base64url')}`;
        const logout = new URL(`${service.issuer}/account/logout`);
        logout.search = new URLSearchParams({ mode: 'current', return_to: 'https://localhost:3410/', initiation }).toString();
        assert.equal((await fetch(logout)).status, 200);
        assert.equal((await (await status()).json()).active, true, 'GET must not revoke before external confirmation');
        const confirm = (value: string) => fetch(`${service.issuer}/account/logout`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ initiation: value }) });
        assert.equal((await confirm(initiation + 'tamper')).status, 400);
        const done = await confirm(initiation);
        assert.equal(done.status, 303);
        assert.equal(done.headers.get('location'), 'https://localhost:3410/');
        assert.deepEqual(await (await status()).json(), { active: false });
        assert.equal((await confirm(initiation)).status, 400, 'signed logout initiation is single-use');
    } finally { await service.close(); }
});
