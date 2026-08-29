const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const EVENT_NAME = /^[a-z][a-z0-9_.]{2,63}$/;
const SOURCES = new Set(['browser', 'home', 'account', 'listener', 'live', 'membership', 'meta', 'backfill']);
const SURFACES = new Set(['home', 'account', 'listen', 'live', 'ops', 'commerce', 'campaigns']);
const ENVIRONMENTS = new Set(['production', 'staging', 'development', 'test']);
const TRAFFIC_CLASSES = new Set(['real', 'internal', 'synthetic', 'test', 'unknown']);
const BROWSER_ORIGIN_CONTEXTS = new Map([
    ['https://harmonicbeacon.com', { surface: 'home', environment: 'production' }],
    ['https://www.harmonicbeacon.com', { surface: 'home', environment: 'production' }],
    ['https://account.harmonicbeacon.com', { surface: 'account', environment: 'production' }],
    ['https://account-staging.harmonicbeacon.com', { surface: 'account', environment: 'staging' }],
    ['https://listen.harmonicbeacon.com', { surface: 'listen', environment: 'production' }],
    ['https://earlybirds-staging.harmonicbeacon.com', { surface: 'listen', environment: 'staging' }],
    ['https://live.harmonicbeacon.com', { surface: 'live', environment: 'production' }],
    ['https://live-staging.harmonicbeacon.com', { surface: 'live', environment: 'staging' }],
]);
const TOP_LEVEL = new Set([
    'schema_version', 'event_id', 'event_name', 'occurred_at', 'source', 'surface',
    'environment', 'visitor_id', 'session_id', 'account_subject', 'page', 'attribution',
    'first_attribution', 'last_attribution',
    'device', 'traffic_class', 'handoff', 'properties',
]);
const CANONICAL_BROWSER_FORBIDDEN = [
    'account.created', 'account.verified', 'identity.linked', 'listener.interval_settled',
    'live.presence_settled', 'membership.activated', 'membership.cancelled',
    'membership.expired', 'payment.confirmed', 'payment.refunded',
];
const PROHIBITED_KEY = /(pass(word|phrase)?|secret|token|authorization|cookie|signed.?url|card|pan|cvv|email|chat|message|audio|video|transcript)/i;

export class ContractError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ContractError';
    }
}

export function browserOriginContext(origin) {
    if (typeof origin !== 'string') return null;
    return BROWSER_ORIGIN_CONTEXTS.get(origin) ?? null;
}

function bounded(value, max, field, nullable = true) {
    if (value === undefined || value === null) {
        if (nullable) return null;
        throw new ContractError(`${field} is required`);
    }
    if (typeof value !== 'string' || value.length > max) throw new ContractError(`${field} is invalid`);
    return value;
}

function strictObject(value, fields, name) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) throw new ContractError(`${name} is invalid`);
    for (const key of Object.keys(value)) {
        if (!fields.has(key)) throw new ContractError(`${name}.${key} is unknown`);
    }
    return value;
}

export function sanitizePath(value) {
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value, 'https://analytics.invalid');
        return `${url.origin === 'https://analytics.invalid' ? '' : url.origin}${url.pathname}`.slice(0, 500) || '/';
    } catch {
        return value.split(/[?#]/, 1)[0].slice(0, 500) || '/';
    }
}

function validateProperties(value) {
    if (value === undefined || value === null) return {};
    if (typeof value !== 'object' || Array.isArray(value)) throw new ContractError('properties is invalid');
    const entries = Object.entries(value);
    if (entries.length > 32) throw new ContractError('properties has too many fields');
    const result = {};
    for (const [key, item] of entries) {
        if (!/^[a-z][a-z0-9_]{0,63}$/i.test(key) || PROHIBITED_KEY.test(key)) {
            throw new ContractError(`properties.${key} is prohibited`);
        }
        if (item !== null && !['string', 'number', 'boolean'].includes(typeof item)) {
            throw new ContractError(`properties.${key} is not scalar`);
        }
        if (typeof item === 'string' && (item.length > 500 || /^(Bearer |https?:\/\/.*[?&](token|sig|signature)=)/i.test(item))) {
            throw new ContractError(`properties.${key} is unsafe`);
        }
        if (typeof item === 'number' && !Number.isFinite(item)) throw new ContractError(`properties.${key} is invalid`);
        result[key] = item;
    }
    return result;
}

export function validateEvent(input, { serverAuthenticated = false } = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ContractError('event must be an object');
    for (const key of Object.keys(input)) {
        if (!TOP_LEVEL.has(key)) throw new ContractError(`${key} is unknown`);
    }
    if (input.schema_version !== 'hb.analytics.event.v1') throw new ContractError('schema_version is unsupported');
    if (!UUID.test(input.event_id ?? '')) throw new ContractError('event_id is invalid');
    if (!EVENT_NAME.test(input.event_name ?? '')) throw new ContractError('event_name is invalid');
    if (!SOURCES.has(input.source)) throw new ContractError('source is invalid');
    if (!SURFACES.has(input.surface)) throw new ContractError('surface is invalid');
    if (!ENVIRONMENTS.has(input.environment)) throw new ContractError('environment is invalid');
    const occurredAt = new Date(input.occurred_at);
    if (!Number.isFinite(occurredAt.getTime())) throw new ContractError('occurred_at is invalid');
    if (input.source === 'browser' && serverAuthenticated) throw new ContractError('browser source cannot use server endpoint');
    if (input.source !== 'browser' && !serverAuthenticated) throw new ContractError('server source requires authentication');
    if (!serverAuthenticated && CANONICAL_BROWSER_FORBIDDEN.includes(input.event_name)) {
        throw new ContractError('browser cannot declare canonical fact');
    }
    const visitorId = input.visitor_id == null ? null : bounded(input.visitor_id, 36, 'visitor_id');
    const sessionId = input.session_id == null ? null : bounded(input.session_id, 36, 'session_id');
    if (visitorId && !UUID.test(visitorId)) throw new ContractError('visitor_id is invalid');
    if (sessionId && !UUID.test(sessionId)) throw new ContractError('session_id is invalid');
    const accountSubject = input.account_subject == null ? null : bounded(input.account_subject, 64, 'account_subject');
    if (accountSubject && !DIGEST.test(accountSubject)) throw new ContractError('account_subject is invalid');
    if (!serverAuthenticated && accountSubject) throw new ContractError('browser cannot declare account_subject');

    const page = strictObject(input.page, new Set(['path', 'title', 'referrer', 'landing']), 'page');
    const attributionFields = new Set([
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
        'fbclid', 'gclid', 'msclkid', 'ttclid', 'referrer', 'landing',
    ]);
    const attribution = strictObject(input.attribution, attributionFields, 'attribution');
    const firstAttribution = strictObject(input.first_attribution, attributionFields, 'first_attribution');
    const lastAttribution = strictObject(input.last_attribution, attributionFields, 'last_attribution');
    const device = strictObject(input.device, new Set(['class', 'browser', 'os', 'language', 'screen']), 'device');
    const trafficClass = input.traffic_class ?? 'unknown';
    if (!TRAFFIC_CLASSES.has(trafficClass)) throw new ContractError('traffic_class is invalid');
    if (!serverAuthenticated && !['real', 'unknown'].includes(trafficClass)) {
        throw new ContractError('browser cannot classify traffic');
    }

    return {
        schema_version: input.schema_version,
        event_id: input.event_id.toLowerCase(),
        event_name: input.event_name,
        occurred_at: occurredAt.toISOString(),
        source: input.source,
        surface: input.surface,
        environment: input.environment,
        visitor_id: visitorId,
        session_id: sessionId,
        account_subject: accountSubject,
        page: page ? {
            path: sanitizePath(page.path),
            title: bounded(page.title, 200, 'page.title'),
            referrer: sanitizePath(page.referrer),
            landing: sanitizePath(page.landing),
        } : null,
        attribution: sanitizeAttribution(attribution, 'attribution'),
        first_attribution: sanitizeAttribution(firstAttribution, 'first_attribution'),
        last_attribution: sanitizeAttribution(lastAttribution ?? attribution, 'last_attribution'),
        device: device ? {
            class: ['desktop', 'mobile', 'tablet', 'unknown'].includes(device.class) ? device.class : 'unknown',
            browser: bounded(device.browser, 40, 'device.browser'),
            os: bounded(device.os, 40, 'device.os'),
            language: bounded(device.language, 20, 'device.language'),
            screen: typeof device.screen === 'string' && /^\d{1,5}x\d{1,5}$/.test(device.screen) ? device.screen : null,
        } : null,
        traffic_class: trafficClass,
        handoff: bounded(input.handoff, 4096, 'handoff'),
        properties: validateProperties(input.properties),
    };
}

function sanitizeAttribution(value, field) {
    return value ? Object.fromEntries(Object.entries(value).map(([key, item]) => [
        key, key === 'referrer' || key === 'landing'
            ? sanitizePath(bounded(item, 500, `${field}.${key}`))
            : bounded(item, key.endsWith('clid') ? 500 : 200, `${field}.${key}`),
    ])) : null;
}

export const contractInternals = { UUID, DIGEST, CANONICAL_BROWSER_FORBIDDEN, PROHIBITED_KEY };
