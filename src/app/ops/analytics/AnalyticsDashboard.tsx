'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { EventResults, CohortHeatmap, deltaPercent, finiteMetric, RankedBars, TrendChart } from './AnalyticsVisuals';
import { calendarDayInTimeZone, shiftCalendarDay } from '@/lib/analytics-calendar-range';

type Row = Record<string, unknown>;
type Dashboard = {
    generated_at: string;
    summary: Row;
    definitions: Record<string, { definition: string; source: string }>;
    commerce: Row[]; acquisition: Row[]; geography: Row[]; devices: Row[];
    pages: Row[]; events: Row[]; memberships: Row[]; campaigns: Row[]; health: Row[]; quality: Row[]; storage: Row[]; series: Row[]; cohorts: Row[];
    listener_activity: Row[]; funnel: Row[]; lifecycle: Row[];
};

const display = (value: unknown) => value == null ? 'Unknown' : String(value);
const number = (value: unknown) => { const n = finiteMetric(value); return n === null ? 'Unknown' : n.toLocaleString(undefined, {maximumFractionDigits: 1}); };

function Table({ rows }: { rows: Row[] }) {
    const columns = useMemo(() => [...new Set(rows.flatMap(row => Object.keys(row)))], [rows]);
    if (rows.length === 0) return <p className="text-sm text-[var(--text-secondary)]">Zero results for this range.</p>;
    return <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Detailed analytics data"><table className="w-full min-w-[640px] text-left text-xs"><thead><tr>{columns.map(column => <th className="border-b border-white/15 p-2" key={column}>{column.replaceAll('_', ' ')}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-b border-white/5">{columns.map(column => <td className="p-2 align-top" key={column}>{typeof row[column] === 'object' ? JSON.stringify(row[column]) : display(row[column])}</td>)}</tr>)}</tbody></table></div>;
}

export default function AnalyticsDashboard({ canExport }: { canExport: boolean }) {
    const initialDay = new Date().toISOString().slice(0, 10);
    const [start, setStart] = useState(shiftCalendarDay(initialDay, -29));
    const [end, setEnd] = useState(initialDay);
    const [traffic, setTraffic] = useState('real');
    const [timezone, setTimezone] = useState('UTC');
    const [applied, setApplied] = useState({ start, end, traffic, timezone });
    const [browserReady, setBrowserReady] = useState(false);
    const [data, setData] = useState<Dashboard | null>(null);
    const [previous, setPrevious] = useState<Dashboard | null>(null);
    const [state, setState] = useState<'loading' | 'ok' | 'invalid' | 'error'>('loading');
    const timezones = useMemo(() => {
        const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
        const values = intl.supportedValuesOf?.('timeZone') ?? [];
        return [...new Set(['UTC', timezone, ...values])];
    }, [timezone]);
    const query = useMemo(() => new URLSearchParams({ ...applied, environment: 'production', compare: 'previous' }), [applied]);
    const load = useCallback(async (signal: AbortSignal) => {
        setState('loading');
        setData(null); setPrevious(null);
        try {
            const response = await fetch(`/api/ops/analytics?${query}`, { cache: 'no-store', signal });
            if (response.status === 400) {
                setData(null); setPrevious(null); setState('invalid'); return;
            }
            if (!response.ok) throw new Error('unavailable');
            const body = await response.json();
            if (signal.aborted) return;
            setData(body.current); setPrevious(body.previous); setState('ok');
        } catch { if (!signal.aborted) setState('error'); }
    }, [query]);
    useEffect(() => {
        const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const today = calendarDayInTimeZone(new Date(), localTimezone);
        setTimezone(localTimezone);
        setStart(shiftCalendarDay(today, -29));
        setEnd(today);
        setApplied({ start: shiftCalendarDay(today, -29), end: today, traffic: 'real', timezone: localTimezone });
        setBrowserReady(true);
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        if (browserReady) void load(controller.signal);
        return () => controller.abort();
    }, [browserReady, load]);

    const cards = data ? [
        ['Visitors', data.summary.visitors, 'visitors'], ['Sessions', data.summary.sessions, 'sessions'],
        ['Accounts', data.summary.created, 'accounts'], ['Verified', data.summary.verified, 'accounts'],
        ['Listeners', data.summary.listeners, 'listening_seconds'], ['Listening hours', finiteMetric(data.summary.listening_seconds) === null ? null : Number(data.summary.listening_seconds) / 3600, 'listening_seconds'],
        ['Attendees', data.summary.attendees, 'attendee_seconds'], ['Event hours', finiteMetric(data.summary.attendee_seconds) === null ? null : Number(data.summary.attendee_seconds) / 3600, 'attendee_seconds'],
    ] as const : [];
    const previousSummary = previous?.summary ?? {};

    return <div className="space-y-6">
        <header><p className="text-xs uppercase tracking-[.2em] text-[var(--lime)]">Internal · production</p><h1 className="text-3xl font-semibold text-[var(--paper)]">Analytics</h1><p className="mt-1 text-sm text-[var(--text-secondary)]">Event results first: attendance, time together and connection signals.</p></header>
        <form className="grid gap-3 rounded-xl border border-white/10 bg-white/5 p-4 sm:grid-cols-2 lg:grid-cols-5" onSubmit={event => { event.preventDefault(); if (browserReady) setApplied({ start, end, traffic, timezone }); }}>
            <label className="text-sm">From<input className="mt-1 block w-full rounded bg-black/20 p-2" type="date" value={start} onChange={event => setStart(event.target.value)} /></label>
            <label className="text-sm">Through<input className="mt-1 block w-full rounded bg-black/20 p-2" type="date" value={end} onChange={event => setEnd(event.target.value)} /></label>
            <label className="text-sm">Timezone<input className="mt-1 block w-full rounded bg-black/20 p-2" list="analytics-timezones" value={timezone} onChange={event => setTimezone(event.target.value)} /><datalist id="analytics-timezones">{timezones.map(value => <option key={value} value={value} />)}</datalist></label>
            <label className="text-sm">Traffic<select className="mt-1 block w-full rounded bg-black/20 p-2" value={traffic} onChange={event => setTraffic(event.target.value)}><option value="real">Real only</option><option value="real,internal">Real + internal</option><option value="real,internal,test,synthetic,unknown">All classes</option></select></label>
            <button className="self-end rounded bg-[var(--lime)] px-4 py-2 font-semibold text-black disabled:opacity-50" disabled={!browserReady} type="submit">Apply</button>
        </form>
        {state === 'loading' ? <p>Loading current data…</p> : null}
        {state === 'invalid' ? <div role="alert" className="rounded border border-amber-400/40 bg-amber-950/20 p-4">Check the date range and IANA timezone, then apply again.</div> : null}
        {state === 'error' ? <div role="alert" className="rounded border border-red-400/40 bg-red-950/30 p-4">Analytics is unavailable; product surfaces are unaffected. Retry shortly.</div> : null}
        {data ? <>
            <EventResults rows={data.events} timezone={applied.timezone} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{cards.map(([label, value, definition]) => {
                const priorKey = label === 'Accounts' ? 'created' : label === 'Verified' ? 'verified' : label === 'Listening hours' ? 'listening_seconds' : label === 'Event hours' ? 'attendee_seconds' : label.toLowerCase();
                const delta = deltaPercent(data.summary[priorKey], previousSummary[priorKey]);
                return <article key={label} title={`${data.definitions[definition]?.definition ?? ''} Source: ${data.definitions[definition]?.source ?? 'mart'}`} className="rounded-xl border border-white/10 bg-white/5 p-4"><p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">{label}</p><p className="mt-1 text-3xl font-semibold">{number(value)}</p><p className="text-xs text-[var(--text-secondary)]">{delta == null ? 'Previous: unknown/zero' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% vs previous`}</p></article>;
            })}</div>
            {data.health.some(row => row.display_state !== 'ok' && row.display_state !== 'disabled') ? <div role="status" className="rounded border border-amber-400/40 bg-amber-950/20 p-4">One or more sources are stale or in error. Metrics remain labeled by source below.</div> : null}
            {data.quality.some(row => row.status === 'error') ? <div role="alert" className="rounded border border-red-400/40 bg-red-950/30 p-4">A data-quality contract is failing. Canonical product systems remain unaffected; inspect Quality checks below.</div> : null}
            <section aria-label="Reading this period" className="rounded-xl border border-[var(--lime)]/25 bg-[var(--lime)]/5 p-5">
                <h2 className="text-lg font-semibold">Reading this period</h2>
                <div className="mt-3 grid gap-4 text-sm md:grid-cols-3">
                    <p><strong className="block text-xl">{Number(data.summary.listeners)>0 && finiteMetric(data.summary.listening_seconds)!==null ? number(Number(data.summary.listening_seconds)/Number(data.summary.listeners)/60) : '—'} min</strong><span className="text-[var(--text-secondary)]">Average total listening per observed listener in this period. Not average visit length.</span></p>
                    <p><strong className="block text-xl">{Number(data.summary.attendees)>0 && finiteMetric(data.summary.attendee_seconds)!==null ? number(Number(data.summary.attendee_seconds)/Number(data.summary.attendees)/60) : '—'} min</strong><span className="text-[var(--text-secondary)]">Average total Live presence per attendee across events. Excludes Staff and test events.</span></p>
                    <p><strong className="block text-xl">{data.events.length}</strong><span className="text-[var(--text-secondary)]">Events with observed attendance. An event without recorded presence is not counted here.</span></p>
                </div>
            </section>
            <section aria-label="Activity over time" className="space-y-3">
                <div><h2 className="text-xl font-semibold">Is participation growing?</h2><p className="text-sm text-[var(--text-secondary)]">Daily aggregates use UTC, with separate scales and units. Daily visitors are not unique people across the full period.</p></div>
                <div className="grid gap-4 lg:grid-cols-3">
                    <TrendChart rows={data.series} metric="visitors" title="Visits across surfaces" unit="daily visitor observations" />
                    <TrendChart rows={data.series} metric="listening_seconds" title="Time spent listening" divisor={3600} unit="hours" />
                    <TrendChart rows={data.series} metric="attendee_seconds" title="Time together in Live" divisor={3600} unit="participant-hours" />
                </div>
            </section>
            <div className="grid gap-4 lg:grid-cols-2">

                <section className="rounded-xl border border-white/10 p-5"><h2 className="mb-1 text-lg font-semibold">Where is activity happening?</h2><p className="mb-5 text-xs text-[var(--text-secondary)]">Independent populations in the selected period, not a linked conversion funnel.</p><RankedBars rows={data.funnel} labelKey="stage_name" valueKey="people" unit="observed" limit={7}/></section>
                <section className="rounded-xl border border-white/10 p-5"><h2 className="mb-1 text-lg font-semibold">Which pages are attracting attention?</h2><p className="mb-5 text-xs text-[var(--text-secondary)]">Top page/referrer combinations by pageviews. Repeated views count.</p><RankedBars rows={data.pages.map(row=>({...row,label:`${row.surface ?? ''} · ${row.path ?? 'Unknown'} · ${row.referrer ?? 'direct'}`}))} labelKey="label" valueKey="pageviews" unit="views"/></section>
                <section className="rounded-xl border border-white/10 p-5"><h2 className="mb-1 text-lg font-semibold">How often do listeners return?</h2><p className="mb-5 text-xs text-[var(--text-secondary)]">Distribution within the returned listener sample (up to 500, ordered by listening time). Not a population retention rate.</p>{data.listener_activity.length === 0 ? <p className="py-6 text-sm text-[var(--text-secondary)]">No listener activity observed in this range.</p> : <RankedBars rows={[1,2,3,7].map((min,i)=>({label:['1 active day','2 active days','3–6 active days','7+ active days'][i],listeners:data.listener_activity.filter(row=>{const days=finiteMetric(row.active_days);return days!==null&&days>=min&&(i===3||days<[2,3,7][i]);}).length}))} labelKey="label" valueKey="listeners" unit="listeners" sort={false}/>}</section>
            </div>
            <section className="rounded-xl border border-white/10 p-5"><h2 className="mb-3 text-lg font-semibold">Do first-time listeners come back?</h2><CohortHeatmap rows={data.cohorts} through={applied.end}/></section>
            <section><h2 className="text-xl font-semibold">Explore the evidence</h2><p className="text-sm text-[var(--text-secondary)]">Open only the detail you need. Exports retain the applied range and access permissions.</p></section>
            <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">{([['Source health', 'health'], ['Quality checks', 'quality'], ['Storage growth', 'storage'], ['Journey funnel', 'funnel'], ['Pages, landings and referrers', 'pages'], ['Acquisition · first and last touch', 'acquisition'], ['Geography', 'geography'], ['Devices', 'devices'], ['Listening frequency and duration', 'listener_activity'], ['Live attendance and reconnections', 'events'], ['Membership lifecycle, MRR and churn', 'lifecycle'], ['Memberships', 'memberships'], ['Confirmed commerce', 'commerce'], ['Meta campaigns', 'campaigns'], ['Retention cohorts', 'cohorts']] as const).map(([title, key]) => <details key={key} className="rounded-xl border border-white/10 bg-white/[.03] p-4"><summary className="cursor-pointer font-medium">{title} <span className="ml-2 text-xs text-[var(--text-secondary)]">{data[key].length} rows</span></summary><div className="my-3 flex justify-end">{canExport ? <a className="text-sm text-[var(--lime)] underline" href={`/api/ops/analytics?${query}&csv=${key}`}>Export CSV</a> : null}</div><Table rows={data[key]} /></details>)}</div>
            <p className="text-xs text-[var(--text-secondary)]">Generated {new Date(data.generated_at).toLocaleString()} · timezone {applied.timezone}. Zero, unknown, stale and error are shown separately.</p>
        </> : null}
    </div>;
}
