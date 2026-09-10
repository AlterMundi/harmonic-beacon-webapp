/** TEST ONLY: external identity simulation, NOT a Beacon Account server.
 * Loopback-only, ephemeral signing key and sessions; never use production secrets.
 * Live's real RP performs discovery, PKCE exchange, signature/nonce/issuer/aud
 * validation, introspection and UserInfo checks against this service. */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const opaque = () => randomBytes(32).toString('base64url');
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const FIXTURE_CLIENT_ID = 'navigation-fixture';
export const FIXTURE_CLIENT_SECRET = 'local-fixture-client-secret-not-for-production';
export const FIXTURE_PASSWORD = 'local-fixture-password';
const subjects: Record<string, string> = { attendee: 'fixture-attendee', operator: 'fixture-operator', facilitator: 'fixture-facilitator', admin: 'fixture-admin', unbound: 'fixture-unbound' };

export async function startAccountFixture(options: { port: number; liveOrigin: string; tls?: { key: Buffer; cert: Buffer } }) {
    const live = new URL(options.liveOrigin);
    if (!['localhost', '127.0.0.1'].includes(live.hostname) || live.protocol !== 'https:' || live.origin !== options.liveOrigin) throw new Error('Fixture requires an exact loopback HTTPS Live origin');
    const { privateKey, publicKey } = await generateKeyPair('ES256');
    const jwk = { ...await exportJWK(publicKey), kid: 'ephemeral-fixture', alg: 'ES256', use: 'sig' };
    type Attempt = { redirect: string; nonce: string; state: string; challenge: string; expires: number };
    type Grant = Attempt & { sub: string; sid: string };
    const attempts = new Map<string, Attempt>();
    const codes = new Map<string, Grant>();
    const tokens = new Map<string, Grant>();
    const sessions = new Map<string, { sub: string; active: boolean }>();
    const logoutStates = new Set<string>();
    let issuer = '';
    const basic = `Basic ${Buffer.from(`${FIXTURE_CLIENT_ID}:${FIXTURE_CLIENT_SECRET}`).toString('base64')}`;
    const json = (res: ServerResponse, body: unknown, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    const html = (res: ServerResponse, body: string) => { res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }); res.end(`<h1>External identity simulation</h1>${body}`); };
    const redirect = (res: ServerResponse, location: string) => { res.writeHead(303, { location, 'cache-control': 'no-store' }); res.end(); };
    const body = async (req: IncomingMessage) => {
        let value = '';
        for await (const chunk of req) { value += chunk; if (value.length > 20_000) throw new Error('Body too large'); }
        return new URLSearchParams(value);
    };
    const handler = async (req: IncomingMessage, res: ServerResponse) => {
        try {
            const url = new URL(req.url!, issuer);
            if (req.method === 'GET' && url.pathname === '/.well-known/openid-configuration') return json(res, {
                issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
                userinfo_endpoint: `${issuer}/userinfo`, introspection_endpoint: `${issuer}/introspect`, end_session_endpoint: `${issuer}/account/logout`,
                code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['client_secret_basic'],
            });
            if (req.method === 'GET' && url.pathname === '/jwks') return json(res, { keys: [jwk] });
            if (req.method === 'GET' && url.pathname === '/authorize') {
                const q = url.searchParams;
                if (q.get('client_id') !== FIXTURE_CLIENT_ID || q.get('redirect_uri') !== `${live.origin}/api/account/callback` || q.get('response_type') !== 'code' || q.get('scope') !== 'openid profile' || q.get('code_challenge_method') !== 'S256' || !/^[\w-]{43}$/.test(q.get('code_challenge') ?? '') || !q.get('state') || !q.get('nonce')) return json(res, { error: 'invalid_request' }, 400);
                const request = opaque();
                attempts.set(request, { redirect: q.get('redirect_uri')!, nonce: q.get('nonce')!, state: q.get('state')!, challenge: q.get('code_challenge')!, expires: Date.now() + 120_000 });
                return html(res, `<form method="post" action="/authorize"><input type="hidden" name="request" value="${request}"><label>Fixture username<input name="username"></label><label>Fixture password<input name="password" type="password"></label><button>Sign in to simulation</button></form>`);
            }
            if (req.method === 'POST' && url.pathname === '/authorize') {
                const q = await body(req);
                const request = q.get('request') ?? '';
                const attempt = attempts.get(request);
                const sub = subjects[q.get('username') ?? ''];
                if (!attempt || attempt.expires < Date.now() || !sub || !equal(q.get('password') ?? '', FIXTURE_PASSWORD)) return json(res, { error: 'invalid_credentials' }, 401);
                attempts.delete(request);
                const sid = opaque(); const code = opaque();
                sessions.set(sid, { sub, active: true });
                codes.set(code, { ...attempt, sid, sub });
                const callback = new URL(attempt.redirect);
                callback.searchParams.set('state', attempt.state); callback.searchParams.set('code', code);
                return redirect(res, callback.href);
            }
            if (req.method === 'POST' && ['/token', '/introspect', '/api/account/session-status'].includes(url.pathname)) {
                if (!equal(req.headers.authorization ?? '', basic)) return json(res, { error: 'invalid_client' }, 401);
                const q = await body(req);
                if (url.pathname === '/token') {
                    const code = q.get('code') ?? ''; const grant = codes.get(code);
                    if (!grant || grant.expires < Date.now() || q.get('grant_type') !== 'authorization_code' || q.get('redirect_uri') !== grant.redirect || createHash('sha256').update(q.get('code_verifier') ?? '').digest('base64url') !== grant.challenge) return json(res, { error: 'invalid_grant' }, 400);
                    codes.delete(code);
                    const access = opaque(); tokens.set(access, grant);
                    const id = await new SignJWT({ nonce: grant.nonce, sid: grant.sid }).setProtectedHeader({ alg: 'ES256', kid: jwk.kid }).setIssuer(issuer).setSubject(grant.sub).setAudience(FIXTURE_CLIENT_ID).setIssuedAt().setExpirationTime('2m').sign(privateKey);
                    return json(res, { access_token: access, id_token: id, token_type: 'Bearer' });
                }
                if (url.pathname === '/introspect') {
                    const grant = tokens.get(q.get('token') ?? '');
                    return json(res, grant && grant.expires > Date.now() && sessions.get(grant.sid)?.active ? { active: true, client_id: FIXTURE_CLIENT_ID, sub: grant.sub } : { active: false });
                }
                const sid = q.get('sid') ?? ''; const session = sessions.get(sid);
                return json(res, session?.active && session.sub === q.get('sub') ? { active: true, iss: issuer, sub: session.sub, sid } : { active: false });
            }
            if (req.method === 'GET' && url.pathname === '/userinfo') {
                const grant = tokens.get((req.headers.authorization ?? '').replace(/^Bearer /, ''));
                return grant && grant.expires > Date.now() && sessions.get(grant.sid)?.active ? json(res, { sub: grant.sub, name: grant.sub }) : json(res, { error: 'invalid_token' }, 401);
            }
            if (['GET', 'POST'].includes(req.method ?? '') && url.pathname === '/account/logout') {
                const q = req.method === 'POST' ? await body(req) : url.searchParams;
                const initiation = q.get('initiation') ?? '';
                if (!/^[\w-]+\.[\w-]+$/.test(initiation)) return json(res, { error: 'invalid_initiation' }, 400);
                const [encoded, signature] = initiation.split('.');
                if (!equal(signature, createHmac('sha256', FIXTURE_CLIENT_SECRET).update(encoded).digest('base64url'))) return json(res, { error: 'invalid_initiation' }, 400);
                const p = JSON.parse(Buffer.from(encoded, 'base64url').toString());
                const now = Math.floor(Date.now() / 1000);
                const session = sessions.get(p.sid);
                if (p.v !== 1 || p.iss !== issuer || p.client_id !== FIXTURE_CLIENT_ID || !session?.active || !['current', 'all'].includes(p.mode) || p.return_to !== `${live.origin}/` || typeof p.state !== 'string' || !p.state || logoutStates.has(p.state) || !Number.isInteger(p.iat) || !Number.isInteger(p.exp) || p.iat > now + 30 || p.exp <= now || p.exp - p.iat > 120) return json(res, { error: 'invalid_initiation' }, 400);
                if (req.method === 'GET') {
                    if (q.get('mode') !== p.mode || q.get('return_to') !== p.return_to) return json(res, { error: 'invalid_initiation' }, 400);
                    return html(res, `<p>Confirm central sign-out (simulation, not the real Account UI).</p><form method="post" action="/account/logout"><input type="hidden" name="initiation" value="${initiation}"><button>Confirm simulated Account sign-out</button></form>`);
                }
                logoutStates.add(p.state);
                for (const [sid, candidate] of sessions) {
                    if (sid === p.sid || (p.mode === 'all' && candidate.sub === session.sub)) candidate.active = false;
                }
                return redirect(res, p.return_to);
            }
            return json(res, { error: 'not_found' }, 404);
        } catch { return json(res, { error: 'invalid_request' }, 400); }
    };
    const server = options.tls ? createHttpsServer(options.tls, (req, res) => { void handler(req, res); }) : createServer((req, res) => { void handler(req, res); });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port, '127.0.0.1', resolve); });
    issuer = `${options.tls ? 'https' : 'http'}://127.0.0.1:${(server.address() as { port: number }).port}`;
    return { issuer, clientId: FIXTURE_CLIENT_ID, clientSecret: FIXTURE_CLIENT_SECRET, userPassword: FIXTURE_PASSWORD, close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
