import { createHash } from 'node:crypto';

export class MetaApiError extends Error {
    constructor(code, retryable, retryAfterMs = 0) {
        super(code);
        this.name = 'MetaApiError';
        this.code = code;
        this.retryable = retryable;
        this.retryAfterMs = retryAfterMs;
    }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const scalar = value => typeof value === 'string' ? value : null;
const integer = value => Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : null;
const decimal = value => Number.isFinite(Number(value)) ? Number(value) : null;
const moneyMinor = value => Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : null;

function actionsObject(value) {
    if (!Array.isArray(value)) return {};
    return Object.fromEntries(value
        .filter(item => item && typeof item.action_type === 'string' && Number.isFinite(Number(item.value)))
        .map(item => [item.action_type.slice(0, 120), Number(item.value)]));
}

export class MetaMarketingClient {
    constructor({ token, accountId, graphVersion = 'v25.0', fetchImpl = fetch, sleepImpl = sleep }) {
        if (!/^v\d+\.\d+$/.test(graphVersion)) throw new Error('invalid Meta Graph API version');
        this.token = token;
        this.accountId = String(accountId || '').replace(/^act_/, '');
        this.origin = `https://graph.facebook.com/${graphVersion}`;
        this.fetchImpl = fetchImpl;
        this.sleepImpl = sleepImpl;
    }

    async request(path, params = {}, attempt = 0) {
        const url = path.startsWith('https://') ? new URL(path) : new URL(`${this.origin}/${path.replace(/^\//, '')}`);
        if (url.hostname !== 'graph.facebook.com' || !url.pathname.startsWith(new URL(this.origin).pathname)) {
            throw new MetaApiError('unsafe_pagination_url', false);
        }
        for (const [key, value] of Object.entries(params)) if (value != null) url.searchParams.set(key, String(value));
        const response = await this.fetchImpl(url, { headers: { authorization: `Bearer ${this.token}`, accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
        if (!response.ok) {
            const retryable = response.status === 429 || response.status >= 500;
            const retryAfterMs = Math.min(60000, Math.max(1000, Number(response.headers.get('retry-after') ?? 0) * 1000 || 2 ** attempt * 1000));
            if (retryable && attempt < 4) {
                await this.sleepImpl(retryAfterMs);
                return this.request(path, params, attempt + 1);
            }
            throw new MetaApiError(`meta_http_${response.status}`, retryable, retryAfterMs);
        }
        return response.json();
    }

    async pages(path, params) {
        const rows = [];
        let nextPath = path;
        let nextParams = params;
        for (let page = 0; nextPath && page < 1000; page += 1) {
            const payload = await this.request(nextPath, nextParams);
            if (!Array.isArray(payload.data)) throw new MetaApiError('meta_schema_data', false);
            rows.push(...payload.data);
            nextPath = payload.paging?.next ?? null;
            nextParams = {};
        }
        if (nextPath) throw new MetaApiError('meta_pagination_limit', false);
        return rows;
    }

    async account() {
        return this.request(`act_${this.accountId}`, { fields: 'currency,timezone_name' });
    }

    async entities(observedAt = new Date()) {
        const common = 'id,name,status,effective_status,created_time,updated_time,start_time,stop_time';
        const definitions = [
            ['campaign', 'campaigns', `${common},objective`],
            ['adset', 'adsets', `${common},campaign_id`],
            ['ad', 'ads', `${common},campaign_id,adset_id`],
        ];
        const account = await this.account();
        const result = [];
        for (const [entityType, edge, fields] of definitions) {
            const rows = await this.pages(`act_${this.accountId}/${edge}`, { fields, limit: 100 });
            for (const row of rows) {
                result.push({
                    provider: 'meta', entityType, entityId: String(row.id),
                    parentId: scalar(row.adset_id ?? row.campaign_id), name: scalar(row.name) ?? '(unnamed)',
                    configuredStatus: scalar(row.status), effectiveStatus: scalar(row.effective_status),
                    objective: scalar(row.objective), startsAt: scalar(row.start_time), endsAt: scalar(row.stop_time),
                    accountCurrency: scalar(account.currency), accountTimezone: scalar(account.timezone_name),
                    observedAt: observedAt.toISOString(),
                    rawDigest: createHash('sha256').update(JSON.stringify(row)).digest('hex'),
                });
            }
        }
        return result;
    }

    async insights({ since, until, attributionWindow = 'default', observedAt = new Date() }) {
        const fields = 'campaign_id,date_start,date_stop,spend,impressions,reach,frequency,clicks,ctr,cpc,cpm,actions';
        const account = await this.account();
        const rows = await this.pages(`act_${this.accountId}/insights`, {
            level: 'campaign', fields, time_increment: 1,
            time_range: JSON.stringify({ since, until }), limit: 100,
        });
        return rows.map(row => ({
            provider: 'meta', entityType: 'campaign', entityId: String(row.campaign_id),
            dateStart: row.date_start, dateStop: row.date_stop, attributionWindow,
            currency: scalar(account.currency), spendMinor: moneyMinor(row.spend), impressions: integer(row.impressions),
            reach: integer(row.reach), frequency: decimal(row.frequency), clicks: integer(row.clicks),
            ctr: decimal(row.ctr), cpcMinor: moneyMinor(row.cpc), cpmMinor: moneyMinor(row.cpm),
            actions: actionsObject(row.actions), observedAt: observedAt.toISOString(),
        }));
    }
}
