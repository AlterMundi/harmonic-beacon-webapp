import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import { browserOriginContext, ContractError, contractInternals, validateEvent } from './contract.mjs';
import { digest, signHandoff, verifyHandoff, verifyServerSignature } from './crypto.mjs';
import { createStore } from './store.mjs';
import { queryDashboard } from './dashboard.mjs';
import { lookupGeo, normalizedClientIp, openGeoDatabase } from './geoip.mjs';

const port = Number(process.env.ANALYTICS_PORT ?? 3300);
const handoffSecret = process.env.ANALYTICS_HANDOFF_SECRET;
const serverSecret = process.env.ANALYTICS_SERVER_EVENT_SECRET;
const networkSecret = process.env.ANALYTICS_NETWORK_DIGEST_SECRET;
if (!handoffSecret || handoffSecret.length < 32 || !serverSecret || serverSecret.length < 32 || !networkSecret || networkSecret.length < 32) {
    throw new Error('analytics HMAC secrets must each contain at least 32 characters');
}
const allowedOrigins = new Set((process.env.ANALYTICS_ALLOWED_ORIGINS ?? 'https://harmonicbeacon.com,https://www.harmonicbeacon.com,https://account.harmonicbeacon.com,https://listen.harmonicbeacon.com,https://live.harmonicbeacon.com,https://account-staging.harmonicbeacon.com,https://earlybirds-staging.harmonicbeacon.com,https://live-staging.harmonicbeacon.com').split(',').map(v => v.trim()).filter(Boolean));
const store = createStore();
const dashboardConnectionString = process.env.ANALYTICS_DASHBOARD_DATABASE_URL;
if (!dashboardConnectionString) throw new Error('ANALYTICS_DASHBOARD_DATABASE_URL is required');
const dashboardPool = new pg.Pool({ connectionString: dashboardConnectionString, max: 3, application_name: 'hb-analytics-dashboard' });
const tracker = await readFile(fileURLToPath(new URL('./tracker.js', import.meta.url)));
const geoDatabase = await openGeoDatabase(process.env.ANALYTICS_GEOIP_DATABASE);
const metrics = { accepted: 0, duplicate: 0, rejected: 0, databaseErrors: 0, handoffs: 0, geoipLookups: 0, geoipMisses: 0 };
const buckets = new Map();

function originAllowed(value) {
    return !value || allowedOrigins.has(value);
}

function headers(origin, extra = {}) {
    return {
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'",
        'x-content-type-options': 'nosniff',
        ...(origin && allowedOrigins.has(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
        ...extra,
    };
}

function respond(res, status, body = '', origin = null, extra = {}) {
    const content = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, headers(origin, { 'content-type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', ...extra }));
    res.end(content);
}

async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > 32768) throw new ContractError('body is too large');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}

function requestContext(req) {
    const forwarded = normalizedClientIp(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress);
    const geo = lookupGeo(geoDatabase, forwarded);
    metrics.geoipLookups += 1;
    if (geo.countryCode === 'unknown') metrics.geoipMisses += 1;
    return {
        ...geo,
        networkDigest: digest(forwarded || 'unknown', networkSecret),
    };
}

function rateAllowed(networkDigest) {
    const minute = Math.floor(Date.now() / 60000);
    const current = buckets.get(networkDigest);
    if (!current || current.minute !== minute) {
        buckets.set(networkDigest, { minute, count: 1 });
        if (buckets.size > 10000) buckets.clear();
        return true;
    }
    current.count += 1;
    return current.count <= 180;
}

function parseTouch(raw) {
    if (!raw || raw.length > 3000) return null;
    try {
        const value = JSON.parse(raw);
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const allowed = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'msclkid', 'ttclid', 'referrer', 'landing'];
        return Object.fromEntries(allowed.map(key => [key, typeof value[key] === 'string' ? value[key].slice(0, key.endsWith('clid') ? 500 : 500) : null]));
    } catch { return null; }
}

const server = http.createServer(async (req, res) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null;
    const url = new URL(req.url ?? '/', 'http://analytics.local');
    if (req.method === 'OPTIONS') {
        if (!originAllowed(origin)) return respond(res, 403, '', null);
        return respond(res, 204, '', origin, { 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,x-hb-event-timestamp,x-hb-event-signature' });
    }
    if (req.method === 'GET' && url.pathname === '/health') {
        return respond(res, 200, { status: 'ok', components: { geoip: geoDatabase ? 'ready' : 'unavailable' } });
    }
    if (req.method === 'GET' && url.pathname === '/ready') {
        try { return respond(res, await store.ready() ? 200 : 503, { status: 'ready' }); }
        catch { return respond(res, 503, { status: 'not_ready' }); }
    }
    if (req.method === 'GET' && url.pathname === '/metrics') {
        const lines = Object.entries(metrics).map(([key, value]) => `hb_analytics_${key}_total ${value}`).join('\n');
        return respond(res, 200, `${lines}\nhb_analytics_geoip_database_loaded ${geoDatabase ? 1 : 0}\n`, null, { 'content-type': 'text/plain; version=0.0.4' });
    }
    if (req.method === 'GET' && url.pathname === '/v1/tracker.js') {
        if (!originAllowed(origin)) return respond(res, 403, 'forbidden');
        return respond(res, 200, tracker, origin, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=300', etag: `"${createHash('sha256').update(tracker).digest('hex')}"` });
    }
    if (req.method === 'GET' && url.pathname === '/v1/handoff') {
        if (!originAllowed(origin)) return respond(res, 403, { error: 'origin_not_allowed' });
        const visitorId = url.searchParams.get('visitor_id');
        const sessionId = url.searchParams.get('session_id');
        if (!contractInternals.UUID.test(visitorId ?? '') || !contractInternals.UUID.test(sessionId ?? '')) return respond(res, 400, { error: 'invalid_identity' }, origin);
        const token = signHandoff({ v: visitorId, s: sessionId, f: parseTouch(url.searchParams.get('first_touch')), l: parseTouch(url.searchParams.get('last_touch')) }, handoffSecret);
        metrics.handoffs += 1;
        return respond(res, 200, { token, expires_in: 900 }, origin);
    }
    if (req.method === 'GET' && url.pathname === '/v1/handoff/resolve') {
        if (!originAllowed(origin)) return respond(res, 403, { error: 'origin_not_allowed' });
        const value = verifyHandoff(url.searchParams.get('token'), handoffSecret);
        if (!value || !contractInternals.UUID.test(value.v ?? '') || !contractInternals.UUID.test(value.s ?? '')) {
            return respond(res, 400, { error: 'invalid_handoff' }, origin);
        }
        return respond(res, 200, { visitor_id: value.v, session_id: value.s, first_touch: value.f ?? null, last_touch: value.l ?? null }, origin);
    }
    if (req.method === 'POST' && url.pathname === '/v1/admin/dashboard') {
        try {
            const raw = await readBody(req);
            if (!verifyServerSignature({ timestamp: req.headers['x-hb-event-timestamp'], signature: req.headers['x-hb-event-signature'], body: raw, secret: serverSecret })) {
                return respond(res, 401, { error: 'invalid_signature' });
            }
            const input = JSON.parse(raw);
            if (!contractInternals.DIGEST.test(input.actor_subject ?? '') || !['ADMIN', 'ANALYTICS_VIEWER', 'ANALYTICS_EXPORTER'].includes(input.actor_role)) {
                return respond(res, 403, { error: 'forbidden' });
            }
            const result = await queryDashboard(dashboardPool, input.filters);
            await dashboardPool.query(`insert into audit.analytics_access(actor_subject,actor_role,action,resource,filters_digest,row_count)
                values($1,$2,$3,'analytics-dashboard',$4,$5)`, [
                input.actor_subject, input.actor_role, input.export === true ? 'csv_export' : 'dashboard_view',
                digest(JSON.stringify(result.filters), networkSecret), input.export === true ? result.series.length : null,
            ]);
            return respond(res, 200, result);
        } catch (error) {
            if (error instanceof SyntaxError || String(error.message).startsWith('invalid_')) return respond(res, 400, { error: 'invalid_request' });
            return respond(res, 503, { error: 'dashboard_unavailable' });
        }
    }
    const browser = req.method === 'POST' && url.pathname === '/v1/events';
    const canonical = req.method === 'POST' && url.pathname === '/v1/server-events';
    if (!browser && !canonical) return respond(res, 404, { error: 'not_found' });
    const expectedBrowserContext = browser ? browserOriginContext(origin) : null;
    if (browser && !expectedBrowserContext) return respond(res, 403, { error: 'origin_not_allowed' });
    const context = requestContext(req);
    if (!rateAllowed(context.networkDigest)) return respond(res, 429, { error: 'rate_limited' }, origin);
    try {
        const raw = await readBody(req);
        if (canonical && !verifyServerSignature({ timestamp: req.headers['x-hb-event-timestamp'], signature: req.headers['x-hb-event-signature'], body: raw, secret: serverSecret })) {
            metrics.rejected += 1;
            return respond(res, 401, { error: 'invalid_signature' });
        }
        const event = validateEvent(JSON.parse(raw), { serverAuthenticated: canonical });
        if (browser && (event.surface !== expectedBrowserContext.surface || event.environment !== expectedBrowserContext.environment)) {
            throw new ContractError('browser context does not match origin');
        }
        if (browser && event.handoff) {
            const handoff = verifyHandoff(event.handoff, handoffSecret);
            if (handoff && contractInternals.UUID.test(handoff.v) && contractInternals.UUID.test(handoff.s)) {
                event.visitor_id = handoff.v;
                event.session_id = handoff.s;
                event.first_attribution = handoff.f ?? event.first_attribution;
                event.last_attribution = handoff.l ?? event.last_attribution ?? event.attribution;
            }
        }
        const inserted = await store.insert(event, context);
        metrics[inserted ? 'accepted' : 'duplicate'] += 1;
        return respond(res, 202, { accepted: true, duplicate: !inserted }, origin);
    } catch (error) {
        if (error instanceof ContractError || error instanceof SyntaxError) {
            metrics.rejected += 1;
            return respond(res, 400, { error: 'invalid_event' }, origin);
        }
        metrics.databaseErrors += 1;
        return respond(res, 503, { error: 'collector_unavailable' }, origin);
    }
});

server.listen(port, '0.0.0.0');
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
        server.close();
        await store.close();
        await dashboardPool.end();
        process.exit(0);
    });
}
