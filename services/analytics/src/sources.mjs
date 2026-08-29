import { createHmac } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const hex64 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export class SourceIngestor {
    constructor({ analyticsPool, identitySecret = process.env.ANALYTICS_IDENTITY_SECRET, urls = {} }) {
        if (!identitySecret || identitySecret.length < 32) throw new Error('ANALYTICS_IDENTITY_SECRET must contain at least 32 characters');
        this.analytics = analyticsPool;
        this.identitySecret = identitySecret;
        this.internal = new Set(String(process.env.ANALYTICS_INTERNAL_ACCOUNT_SUBJECTS ?? '').split(',').map(v => v.trim()).filter(hex64));
        this.sources = Object.fromEntries(Object.entries({
            listener: urls.listener ?? process.env.ANALYTICS_LISTENER_SOURCE_URL,
            live: urls.live ?? process.env.ANALYTICS_LIVE_SOURCE_URL,
            authority: urls.authority ?? process.env.ANALYTICS_AUTHORITY_SOURCE_URL,
        }).filter(([, value]) => value).map(([key, connectionString]) => [key, new Pool({
            connectionString, max: 1, application_name: `hb-analytics-source-${key}`,
            statement_timeout: 15000, query_timeout: 20000,
        })]));
    }

    subject(namespace, value) {
        return createHmac('sha256', this.identitySecret).update(`${namespace}\0${value}`).digest('hex');
    }

    traffic(accountSubject, explicit = null) {
        if (explicit === 'synthetic') return 'synthetic';
        if (explicit === 'test') return 'test';
        return this.internal.has(accountSubject) ? 'internal' : 'real';
    }

    async watermark(source) {
        const result = await this.analytics.query('select watermark from ops.source_watermarks where source=$1', [source]);
        const value = result.rows[0]?.watermark?.updated_at;
        const parsed = value ? new Date(value) : new Date(0);
        return Number.isFinite(parsed.getTime()) ? new Date(parsed.getTime() - 86400000) : new Date(0);
    }

    async mark(source, { status, read = 0, written = 0, updatedAt = null, errorCode = null }) {
        await this.analytics.query(`insert into ops.source_watermarks
            (source,watermark,last_attempt_at,last_success_at,lag_seconds,status,rows_read,rows_written,last_error_code,updated_at)
            values($1,jsonb_build_object('updated_at',$2::text),now(),case when $3='ok' then now() else null end,
                   case when $2::timestamptz is null then null else extract(epoch from(now()-$2::timestamptz))::int end,$3,$4,$5,$6,now())
            on conflict(source) do update set watermark=case when $3='ok' then excluded.watermark else ops.source_watermarks.watermark end,
              last_attempt_at=now(),last_success_at=case when $3='ok' then now() else ops.source_watermarks.last_success_at end,
              lag_seconds=excluded.lag_seconds,status=$3,rows_read=$4,rows_written=$5,last_error_code=$6,updated_at=now()`,
        [source, updatedAt?.toISOString() ?? null, status, read, written, errorCode]);
    }

    async syncListener() {
        const source = this.sources.listener;
        if (!source) return this.mark('listener', { status: 'disabled', errorCode: 'source_url_missing' });
        const since = await this.watermark('listener');
        const [accounts, legacyIntervals, durableIntervals, memberships] = await Promise.all([
            source.query(`select u.id,u.created_at,u.updated_at,u.email_verified,s.issuer,s.subject,
                min(i.provider_id) filter(where i.provider_id is not null) as auth_method
                from early_bird_users u left join early_bird_identities i on i.user_id=u.id
                left join listener_account_subjects s on s.account_id=u.id
                where u.updated_at >= $1 or s.created_at >= $1 group by u.id,s.issuer,s.subject`, [since]),
            source.query(`select id,account_id,device_digest,created_at,last_seen_at,expires_at,evicted_at,presence::text
                from early_bird_stream_leases where last_seen_at >= $1`, [since]),
            source.query(`select i.id,i.account_id,i.device_digest,i.started_at,
                least(coalesce(i.ended_at,i.last_heartbeat_at + interval '45 seconds'),l.expires_at) as ended_at,
                i.source_category,i.access_class,i.synthetic,i.updated_at
                from early_bird_listening_intervals i join early_bird_stream_leases l on l.id=i.lease_id
                where i.updated_at >= $1`, [since]),
            source.query(`select id,account_id,revision,state::text,source::text,offer_code,effective_at,paid_through,
                provider,amount_minor,currency,synthetic,updated_at
                from early_bird_membership_projections where updated_at >= $1`, [since]),
        ]);
        const db = await this.analytics.connect();
        let written = 0;
        try {
            await db.query('begin');
            for (const row of accounts.rows) {
                const subject = this.subject('account', row.id);
                await db.query(`insert into mart.account_facts
                    (source_system,source_key_digest,account_subject,created_at,verified_at,auth_method,last_active_at,traffic_class,environment)
                    values('listener',$1,$2,$3,case when $4 then $5 else null end,$6,$5,$7,'production')
                    on conflict(source_system,source_key_digest) do update set verified_at=excluded.verified_at,
                      auth_method=excluded.auth_method,last_active_at=greatest(mart.account_facts.last_active_at,excluded.last_active_at),
                      traffic_class=excluded.traffic_class,ingested_at=now()`, [
                    this.subject('source-key', `listener-account:${row.id}`), subject, row.created_at,
                    row.email_verified, row.updated_at, row.auth_method, this.traffic(subject),
                ]);
                if (row.issuer && row.subject) {
                    await db.query(`insert into identity_map.subject_aliases(alias_subject,account_subject,issuer_digest,linked_at,source)
                        values($1,$2,$3,$4,'listener-account-subject') on conflict(alias_subject) do update set
                        account_subject=excluded.account_subject,issuer_digest=excluded.issuer_digest,updated_at=now()`, [
                        this.subject('account-oidc', `${row.issuer}\0${row.subject}`), subject,
                        this.subject('issuer', row.issuer), row.created_at,
                    ]);
                }
                written += 1;
            }
            for (const row of legacyIntervals.rows) {
                const endedAt = [row.last_seen_at, row.expires_at, row.evicted_at].filter(Boolean).map(v => new Date(v)).sort((a, b) => a - b)[0];
                if (!endedAt || endedAt < new Date(row.created_at)) continue;
                const subject = this.subject('account', row.account_id);
                await db.query(`insert into mart.listening_intervals
                    (source_system,source_key,account_subject,device_subject,started_at,ended_at,source_category,access_class,environment,traffic_class)
                    values('listener-lease-backfill',$1,$2,$3,$4,$5,$6,$7,'production',$8)
                    on conflict(source_system,source_key) do update set ended_at=greatest(mart.listening_intervals.ended_at,excluded.ended_at),ingested_at=now()`, [
                    row.id, subject, this.subject('device', row.device_digest), row.created_at, endedAt,
                    row.presence === 'PLAYING' ? 'beacon' : 'unknown', 'legacy-lease', this.traffic(subject),
                ]);
                written += 1;
            }
            for (const row of durableIntervals.rows) {
                if (!row.ended_at || new Date(row.ended_at) < new Date(row.started_at)) continue;
                const subject = this.subject('account', row.account_id);
                await db.query(`insert into mart.listening_intervals
                    (source_system,source_key,account_subject,device_subject,started_at,ended_at,source_category,access_class,environment,traffic_class)
                    values('listener-interval',$1,$2,$3,$4,$5,$6,$7,'production',$8)
                    on conflict(source_system,source_key) do update set ended_at=greatest(mart.listening_intervals.ended_at,excluded.ended_at),ingested_at=now()`, [
                    row.id, subject, this.subject('device', row.device_digest), row.started_at, row.ended_at,
                    row.source_category, row.access_class, row.synthetic ? 'synthetic' : this.traffic(subject),
                ]);
                written += 1;
            }
            for (const row of memberships.rows) {
                const subject = this.subject('account', row.account_id);
                const classification = row.synthetic ? 'synthetic' : this.traffic(subject);
                await db.query(`insert into mart.membership_snapshots
                    (source_system,source_key,account_subject,revision,state,provider,offer_code,currency,amount_minor,effective_at,paid_through,terminal_at,traffic_class,environment)
                    values('listener-projection',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                      case when $4 in ('EXPIRED','REFUNDED','CANCELLED') then $11 else null end,$12,'production')
                    on conflict(source_system,source_key,revision) do update set state=excluded.state,paid_through=excluded.paid_through,
                      terminal_at=excluded.terminal_at,traffic_class=excluded.traffic_class,ingested_at=now()`, [
                    row.id, subject, row.revision, row.state, row.provider ?? row.source, row.offer_code,
                    row.currency, row.amount_minor, row.effective_at, row.paid_through, row.updated_at, classification,
                ]);
                written += 1;
            }
            await db.query('commit');
        } catch (error) { await db.query('rollback'); throw error; } finally { db.release(); }
        const latest = [...accounts.rows, ...memberships.rows].reduce((value, row) => Math.max(value, new Date(row.updated_at).getTime()), since.getTime());
        await this.mark('listener', { status: 'ok', read: accounts.rowCount + legacyIntervals.rowCount + durableIntervals.rowCount + memberships.rowCount, written, updatedAt: new Date(latest) });
    }

    async syncLive() {
        const source = this.sources.live;
        if (!source) return this.mark('live', { status: 'disabled', errorCode: 'source_url_missing' });
        const since = await this.watermark('live');
        const [result, durable] = await Promise.all([source.query(`select p.id,p.participant_identity,p.staff_user_id,p.joined_at,p.left_at,p.updated_at,
            s.id as event_id,s.ended_at as event_ended_at,s.is_test,s.status::text
            from session_participants p join scheduled_sessions s on s.id=p.scheduled_session_id
            where p.updated_at >= $1`, [since]), source.query(`select i.id,i.generation,i.started_at,
            least(coalesce(i.ended_at,i.last_heartbeat_at + interval '45 seconds'),
                  coalesce(s.ended_at,i.last_heartbeat_at + interval '45 seconds')) as ended_at,
            i.end_reason,i.reconnect_count,i.updated_at,p.participant_identity,p.staff_user_id,
            t.account_id,t.account_issuer,s.id as event_id,s.is_test
            from live_presence_intervals i join session_participants p on p.id=i.participant_id
            join scheduled_sessions s on s.id=i.scheduled_session_id
            left join ticket_entitlements t on t.id=p.ticket_entitlement_id
            where i.updated_at >= $1`, [since])]);
        let written = 0;
        for (const row of result.rows) {
            const endedAt = row.left_at ?? row.event_ended_at ?? (['ENDED','CANCELLED'].includes(row.status) ? row.updated_at : null);
            if (!endedAt || new Date(endedAt) < new Date(row.joined_at)) continue;
            const isStaff = Boolean(row.staff_user_id);
            // Legacy Live identities are event-scoped pseudonyms, not Account subjects.
            // Future presence leases carry an authenticated Account subject separately.
            const person = this.subject(isStaff ? 'staff-person' : 'live-person', row.staff_user_id ?? row.participant_identity);
            const accountSubject = null;
            const traffic = row.is_test ? 'test' : isStaff ? 'internal' : this.traffic(accountSubject);
            await this.analytics.query(`insert into mart.live_presence_intervals
                (source_system,source_key,event_subject,person_subject,account_subject,role,started_at,ended_at,reconnect_count,end_reason,is_staff,is_test,environment,traffic_class)
                values('live-participant-backfill',$1,$2,$3,$4,$5,$6,$7,0,$8,$9,$10,'production',$11)
                on conflict(source_system,source_key) do update set ended_at=greatest(mart.live_presence_intervals.ended_at,excluded.ended_at),
                  end_reason=excluded.end_reason,ingested_at=now()`, [
                row.id, this.subject('event', row.event_id), person, accountSubject, isStaff ? 'staff' : 'attendee',
                row.joined_at, endedAt, row.left_at ? 'left' : 'event_closed', isStaff, row.is_test, traffic,
            ]);
            written += 1;
        }
        for (const row of durable.rows) {
            if (!row.ended_at || new Date(row.ended_at) < new Date(row.started_at)) continue;
            const isStaff = Boolean(row.staff_user_id);
            const person = this.subject(isStaff ? 'staff-person' : 'live-person', row.staff_user_id ?? row.participant_identity);
            let accountSubject = null;
            if (!isStaff && row.account_id && row.account_issuer) {
                const alias = this.subject('account-oidc', `${row.account_issuer}\0${row.account_id}`);
                const linked = await this.analytics.query('select account_subject from identity_map.subject_aliases where alias_subject=$1', [alias]);
                accountSubject = linked.rows[0]?.account_subject ?? alias;
            }
            const traffic = row.is_test ? 'test' : isStaff ? 'internal' : this.traffic(accountSubject);
            await this.analytics.query(`insert into mart.live_presence_intervals
                (source_system,source_key,event_subject,person_subject,account_subject,role,started_at,ended_at,reconnect_count,end_reason,is_staff,is_test,environment,traffic_class)
                values('live-presence',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'production',$12)
                on conflict(source_system,source_key) do update set ended_at=greatest(mart.live_presence_intervals.ended_at,excluded.ended_at),
                  reconnect_count=excluded.reconnect_count,end_reason=excluded.end_reason,ingested_at=now()`, [
                row.id, this.subject('event', row.event_id), person, accountSubject, isStaff ? 'staff' : 'attendee',
                row.started_at, row.ended_at, row.reconnect_count, row.end_reason ?? 'heartbeat_timeout', isStaff, row.is_test, traffic,
            ]);
            written += 1;
        }
        const latest = [...result.rows, ...durable.rows].reduce((value, row) => Math.max(value, new Date(row.updated_at).getTime()), since.getTime());
        await this.mark('live', { status: 'ok', read: result.rowCount + durable.rowCount, written, updatedAt: new Date(latest) });
    }

    async syncAuthority() {
        const source = this.sources.authority;
        if (!source) return this.mark('authority', { status: 'disabled', errorCode: 'source_url_missing' });
        const since = await this.watermark('authority');
        const [subscriptions, payments] = await Promise.all([
            source.query(`select s.id,s.account_ref,a.account_id,s.provider,s.state,s.currency,s.amount_minor,s.paid_through,
                s.cancelled_at,s.created_at,s.updated_at,b.sandbox
                from early_bird_subscriptions s join early_bird_accounts a on a.id=s.account_ref
                left join early_bird_checkout_bindings b on b.id=s.checkout_binding_id where s.updated_at >= $1`, [since]),
            source.query(`select e.id,e.external_event_id,e.event_type,e.occurred_at,e.created_at,e.payload,
                s.id as subscription_id,s.provider,s.currency,s.amount_minor,a.account_id,b.sandbox
                from early_bird_provider_events e join early_bird_subscriptions s on s.external_subscription_id=e.external_subscription_id
                join early_bird_accounts a on a.id=s.account_ref
                left join early_bird_checkout_bindings b on b.id=s.checkout_binding_id
                where e.status='PROCESSED' and e.event_type in ('PAYMENT_SUCCEEDED','PAYMENT_REFUNDED') and e.created_at >= $1`, [since]),
        ]);
        const db = await this.analytics.connect();
        let written = 0;
        try {
            await db.query('begin');
            for (const row of subscriptions.rows) {
                const subject = this.subject('account', row.account_id);
                const traffic = row.sandbox ? 'test' : this.traffic(subject);
                await db.query(`insert into mart.membership_snapshots
                    (source_system,source_key,account_subject,revision,state,provider,currency,amount_minor,effective_at,paid_through,terminal_at,traffic_class,environment)
                    values('authority',$1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,'production')
                    on conflict(source_system,source_key,revision) do update set state=excluded.state,paid_through=excluded.paid_through,
                      terminal_at=excluded.terminal_at,traffic_class=excluded.traffic_class,ingested_at=now()`, [
                    row.id, subject, row.state, row.provider, row.currency, row.amount_minor, row.created_at,
                    row.paid_through, row.cancelled_at, traffic,
                ]);
                written += 1;
            }
            for (const row of payments.rows) {
                const subject = this.subject('account', row.account_id);
                const traffic = row.sandbox ? 'test' : this.traffic(subject);
                const state = row.event_type === 'PAYMENT_SUCCEEDED' ? 'confirmed' : 'refunded';
                const amount = state === 'confirmed' ? Number(row.payload?.amount_minor ?? row.amount_minor) : row.amount_minor;
                const currency = state === 'confirmed' ? String(row.payload?.currency ?? row.currency) : row.currency;
                if (!Number.isInteger(amount) || amount < 0 || !/^[A-Z]{3}$/.test(currency ?? '')) continue;
                await db.query(`insert into mart.payment_facts
                    (source_system,source_key_digest,account_subject,membership_source_key,provider,state,amount_minor,currency,occurred_at,traffic_class,environment)
                    values('authority',$1,$2,$3,$4,$5,$6,$7,$8,$9,'production')
                    on conflict(source_system,source_key_digest) do update set state=excluded.state,amount_minor=excluded.amount_minor,
                      currency=excluded.currency,traffic_class=excluded.traffic_class,ingested_at=now()`, [
                    this.subject('payment-event', row.external_event_id ?? row.id), subject, row.subscription_id,
                    row.provider, state, amount, currency, row.occurred_at ?? row.created_at, traffic,
                ]);
                written += 1;
            }
            await db.query('commit');
        } catch (error) { await db.query('rollback'); throw error; } finally { db.release(); }
        const latest = subscriptions.rows.reduce((value, row) => Math.max(value, new Date(row.updated_at).getTime()), since.getTime());
        await this.mark('authority', { status: 'ok', read: subscriptions.rowCount + payments.rowCount, written, updatedAt: new Date(latest) });
    }

    async syncAll() {
        const outcomes = [];
        for (const [name, method] of [['listener', 'syncListener'], ['live', 'syncLive'], ['authority', 'syncAuthority']]) {
            try { await this[method](); outcomes.push({ name, ok: true }); }
            catch (error) {
                const errorCode = createHmac('sha256', this.identitySecret).update(String(error.code ?? error.name ?? 'source_error')).digest('hex').slice(0, 32);
                await this.mark(name, { status: 'error', errorCode });
                outcomes.push({ name, ok: false });
            }
        }
        return outcomes;
    }

    async close() { await Promise.all(Object.values(this.sources).map(pool => pool.end())); }
}
