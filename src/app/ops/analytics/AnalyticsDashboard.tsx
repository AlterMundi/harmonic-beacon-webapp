'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Row = Record<string, unknown>;
type Dashboard = {
    generated_at: string;
    summary: Row;
    definitions: Record<string, { definition: string; source: string }>;
    commerce: Row[]; acquisition: Row[]; geography: Row[]; devices: Row[];
    pages: Row[]; events: Row[]; memberships: Row[]; campaigns: Row[]; health: Row[]; quality: Row[]; storage: Row[]; series: Row[]; cohorts: Row[];
    listener_activity: Row[]; funnel: Row[]; lifecycle: Row[];
};

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const display = (value: unknown) => value == null ? 'Unknown' : String(value);
const number = (value: unknown) => Number(value ?? 0).toLocaleString();

function Table({ rows }: { rows: Row[] }) {
    const columns = useMemo(() => [...new Set(rows.flatMap(row => Object.keys(row)))], [rows]);
    if (rows.length === 0) return <p className="text-sm text-[var(--text-secondary)]">Zero results for this range.</p>;
    return <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-xs"><thead><tr>{columns.map(column => <th className="border-b border-white/15 p-2" key={column}>{column.replaceAll('_', ' ')}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-b border-white/5">{columns.map(column => <td className="p-2 align-top" key={column}>{typeof row[column] === 'object' ? JSON.stringify(row[column]) : display(row[column])}</td>)}</tr>)}</tbody></table></div>;
}

export default function AnalyticsDashboard({ canExport }: { canExport: boolean }) {
    const [start, setStart] = useState(isoDay(new Date(Date.now() - 30 * 86400000)));
    const [end, setEnd] = useState(isoDay(new Date(Date.now() + 86400000)));
    const [traffic, setTraffic] = useState('real');
    const [data, setData] = useState<Dashboard | null>(null);
    const [previous, setPrevious] = useState<Dashboard | null>(null);
    const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const query = useMemo(() => new URLSearchParams({ start, end, traffic, timezone, environment: 'production', compare: 'previous' }), [start, end, traffic, timezone]);
    const load = useCallback(async () => {
        setState('loading');
        try {
            const response = await fetch(`/api/ops/analytics?${query}`, { cache: 'no-store' });
            if (!response.ok) throw new Error('unavailable');
            const body = await response.json();
            setData(body.current); setPrevious(body.previous); setState('ok');
        } catch { setState('error'); }
    }, [query]);
    useEffect(() => { void load(); }, [load]);

    const cards = data ? [
        ['Visitors', data.summary.visitors, 'visitors'], ['Sessions', data.summary.sessions, 'sessions'],
        ['Accounts', data.summary.created, 'accounts'], ['Verified', data.summary.verified, 'accounts'],
        ['Listeners', data.summary.listeners, 'listening_seconds'], ['Listening hours', Math.round(Number(data.summary.listening_seconds ?? 0) / 3600), 'listening_seconds'],
        ['Attendees', data.summary.attendees, 'attendee_seconds'], ['Event hours', Math.round(Number(data.summary.attendee_seconds ?? 0) / 3600), 'attendee_seconds'],
    ] as const : [];
    const previousSummary = previous?.summary ?? {};

    return <div className="space-y-6">
        <header><p className="text-xs uppercase tracking-[.2em] text-[var(--lime)]">Internal · production</p><h1 className="text-3xl font-semibold text-[var(--paper)]">Analytics</h1><p className="mt-1 text-sm text-[var(--text-secondary)]">Acquisition, product, events, memberships and confirmed commerce.</p></header>
        <form className="grid gap-3 rounded-xl border border-white/10 bg-white/5 p-4 sm:grid-cols-4" onSubmit={event => { event.preventDefault(); void load(); }}>
            <label className="text-sm">From<input className="mt-1 block w-full rounded bg-black/20 p-2" type="date" value={start} onChange={event => setStart(event.target.value)} /></label>
            <label className="text-sm">Through<input className="mt-1 block w-full rounded bg-black/20 p-2" type="date" value={end} onChange={event => setEnd(event.target.value)} /></label>
            <label className="text-sm">Traffic<select className="mt-1 block w-full rounded bg-black/20 p-2" value={traffic} onChange={event => setTraffic(event.target.value)}><option value="real">Real only</option><option value="real,internal">Real + internal</option><option value="real,internal,test,synthetic,unknown">All classes</option></select></label>
            <button className="self-end rounded bg-[var(--lime)] px-4 py-2 font-semibold text-black" type="submit">Apply</button>
        </form>
        {state === 'loading' ? <p>Loading current data…</p> : null}
        {state === 'error' ? <div role="alert" className="rounded border border-red-400/40 bg-red-950/30 p-4">Analytics is unavailable; product surfaces are unaffected. Retry shortly.</div> : null}
        {data ? <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{cards.map(([label, value, definition]) => {
                const priorKey = label === 'Accounts' ? 'created' : label === 'Verified' ? 'verified' : label === 'Listening hours' ? 'listening_seconds' : label === 'Event hours' ? 'attendee_seconds' : label.toLowerCase();
                const prior = Number(previousSummary[priorKey] ?? 0); const current = Number(value ?? 0); const delta = prior === 0 ? null : Math.round((current - prior) * 1000 / prior) / 10;
                return <article key={label} title={`${data.definitions[definition]?.definition ?? ''} Source: ${data.definitions[definition]?.source ?? 'mart'}`} className="rounded-xl border border-white/10 bg-white/5 p-4"><p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">{label}</p><p className="mt-1 text-3xl font-semibold">{number(value)}</p><p className="text-xs text-[var(--text-secondary)]">{delta == null ? 'Previous: unknown/zero' : `${delta >= 0 ? '+' : ''}${delta}% vs previous`}</p></article>;
            })}</div>
            {data.health.some(row => row.display_state !== 'ok' && row.display_state !== 'disabled') ? <div role="status" className="rounded border border-amber-400/40 bg-amber-950/20 p-4">One or more sources are stale or in error. Metrics remain labeled by source below.</div> : null}
            {data.quality.some(row => row.status === 'error') ? <div role="alert" className="rounded border border-red-400/40 bg-red-950/30 p-4">A data-quality contract is failing. Canonical product systems remain unaffected; inspect Quality checks below.</div> : null}
            {([['Source health', 'health'], ['Quality checks', 'quality'], ['Storage growth', 'storage'], ['Journey funnel', 'funnel'], ['Pages, landings and referrers', 'pages'], ['Acquisition · first and last touch', 'acquisition'], ['Geography', 'geography'], ['Devices', 'devices'], ['Listening frequency and duration', 'listener_activity'], ['Live attendance and reconnections', 'events'], ['Membership lifecycle, MRR and churn', 'lifecycle'], ['Memberships', 'memberships'], ['Confirmed commerce', 'commerce'], ['Meta campaigns', 'campaigns'], ['Retention cohorts', 'cohorts']] as const).map(([title, key]) => <section key={key} className="rounded-xl border border-white/10 bg-white/[.03] p-4"><div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">{title}</h2>{canExport ? <a className="text-sm text-[var(--lime)] underline" href={`/api/ops/analytics?${query}&csv=${key}`}>Export CSV</a> : null}</div><Table rows={data[key]} /></section>)}
            <p className="text-xs text-[var(--text-secondary)]">Generated {new Date(data.generated_at).toLocaleString()} · timezone {timezone}. Zero, unknown, stale and error are shown separately.</p>
        </> : null}
    </div>;
}
