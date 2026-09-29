'use client';

import { useState } from 'react';
export type AnalyticsRow = Record<string, unknown>;
export function finiteMetric(value: unknown): number | null {
    if (value == null || value === '' || typeof value === 'boolean') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}
export function deltaPercent(current: unknown, previous: unknown): number | null {
    const a = finiteMetric(current), b = finiteMetric(previous);
    return a === null || b === null || b === 0 ? null : (a - b) * 100 / b;
}
const format = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });

export function RankedBars({ rows, labelKey, valueKey, unit = '', limit = 6, sort = true }: {
    rows: AnalyticsRow[]; labelKey: string; valueKey: string; unit?: string; limit?: number; sort?: boolean;
}) {
    const values = rows.map(row => ({label: String(row[labelKey] ?? 'Unknown'), value: finiteMetric(row[valueKey])}))
        .filter((row): row is {label: string; value: number} => row.value !== null && row.value >= 0)
        .sort((a,b) => sort ? b.value-a.value : 0).slice(0,limit);
    const max = Math.max(1, ...values.map(row => row.value));
    if (!values.length) return <p className="py-6 text-sm text-[var(--text-secondary)]">No observations for this range.</p>;
    return <ol className="space-y-4">{values.map((row,index) => <li key={`${row.label}:${index}`}>
        <div className="mb-1 flex justify-between gap-4 text-sm"><span className="truncate" title={row.label}>{row.label}</span><span className="shrink-0 font-mono">{format(row.value)} {unit}</span></div>
        <div className="h-2 rounded bg-white/5" aria-hidden="true"><div className="h-full rounded bg-[var(--lime)]/70" style={{width:`${row.value/max*100}%`}} /></div>
    </li>)}</ol>;
}

export function TrendChart({ rows, metric, title, divisor = 1, unit = '' }: {
    rows: AnalyticsRow[]; metric: string; title: string; divisor?: number; unit?: string;
}) {
    const [selected, setSelected] = useState<number | null>(null);
    const byDay = new Map<string, number>();
    for (const row of rows) {
        const value = finiteMetric(row[metric]);
        const day = String(row.metric_date ?? '').slice(0,10);
        if (value !== null && /^\d{4}-\d{2}-\d{2}$/.test(day)) byDay.set(day,(byDay.get(day) ?? 0)+value/divisor);
    }
    const points = [...byDay].sort(([a],[b])=>a.localeCompare(b));
    const max = Math.max(1,...points.map(([,value])=>value));
    const first = points.length ? Date.parse(points[0][0]) : 0;
    const span = Math.max(86400000,points.length ? Date.parse(points[points.length-1][0])-first : 0);
    const xy = points.map(([day,value])=>({x:40+(Date.parse(day)-first)/span*500,y:125-value/max*100}));
    const active = selected !== null ? points[selected] : null;
    return <section className="min-w-0 rounded-xl border border-white/10 bg-white/[.03] p-4">
        <h3 className="text-sm font-medium">{title}</h3>
        {!points.length ? <p className="py-10 text-sm text-[var(--text-secondary)]">No observations for this range.</p> : <>
            <svg viewBox="0 0 570 160" className="mt-2 w-full" role="img" aria-label={`${title}: ${points.length} observed days. Daily values available below.`}>
                {[0,.5,1].map(fraction=><g key={fraction}><line x1="40" x2="540" y1={125-fraction*100} y2={125-fraction*100} stroke="currentColor" opacity=".12"/><text x="34" y={129-fraction*100} textAnchor="end" fill="currentColor" fontSize="10">{format(max*fraction)}</text></g>)}
                {xy.slice(1).map((p,i)=>Date.parse(points[i+1][0])-Date.parse(points[i][0])<=86400000 ? <line key={i} x1={xy[i].x} y1={xy[i].y} x2={p.x} y2={p.y} stroke="var(--lime)" strokeWidth="2"/> : null)}
                {xy.map((p,i)=><circle key={points[i][0]} cx={p.x} cy={p.y} r="3" fill="var(--lime)" onMouseEnter={()=>setSelected(i)}><title>{points[i][0]}: {format(points[i][1])} {unit}</title></circle>)}
                <text x="40" y="151" fill="currentColor" fontSize="10">{points[0][0]}</text><text x="540" y="151" fill="currentColor" fontSize="10" textAnchor="end">{points[points.length-1][0]}</text>
            </svg>
            <p className="min-h-5 text-xs text-[var(--text-secondary)]">{active ? `${active[0]} · ${format(active[1])} ${unit}` : `${unit} · Missing days are not assumed to be zero.`}</p>
            <details className="mt-2 text-xs"><summary className="cursor-pointer">Daily values</summary><div className="mt-2 max-h-48 overflow-auto"><table className="w-full"><thead><tr><th className="text-left">Day</th><th className="text-right">{unit || title}</th></tr></thead><tbody>{points.map(([day,value])=><tr key={day}><td>{day}</td><td className="text-right">{format(value)}</td></tr>)}</tbody></table></div></details>
        </>}
    </section>;
}

export function CohortHeatmap({ rows, through }: { rows: AnalyticsRow[]; through: string }) {
    const days = [0,1,2,3,7,14,28];
    const groups = new Map<string, Map<number, number>>();
    for (const row of rows) {
        const date = String(row.cohort_date ?? '').slice(0,10);
        const day = finiteMetric(row.day_number), count = finiteMetric(row.listeners);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || day === null || count === null) continue;
        if (!groups.has(date)) groups.set(date,new Map());
        groups.get(date)!.set(day,count);
    }
    const cohorts = [...groups].sort(([a],[b])=>b.localeCompare(a)).slice(0,8);
    if (!cohorts.length) return <p className="py-6 text-sm text-[var(--text-secondary)]">No listener cohorts observed in this range.</p>;
    return <div className="overflow-x-auto"><table className="w-full min-w-[480px] border-separate border-spacing-1 text-xs">
        <caption className="mb-3 text-left text-[var(--text-secondary)]">Last 8 first-listen cohorts · observed return on each exact day, not continuous retention. A dash means unobserved or not yet elapsed.</caption>
        <thead><tr><th className="text-left">First listen</th><th>People</th>{days.map(day=><th key={day}>D{day}</th>)}</tr></thead>
        <tbody>{cohorts.map(([date,values])=>{
            const base = values.get(0);
            return <tr key={date}><th className="text-left font-normal">{date}</th><td className="text-center">{base ?? '—'}</td>{days.map(day=>{
                const mature = Date.parse(date)+day*86400000 <= Date.parse(through);
                const count = values.get(day);
                const pct = mature && base && count !== undefined ? count/base*100 : null;
                return <td key={day} className="rounded p-2 text-center" style={pct===null?undefined:{background:`rgba(163,230,53,${Math.min(1,pct/100)*.35+.05})`}} title={pct===null?'No comparable observation':`${count} of ${base} listeners returned on day ${day}`}>{pct===null?'—':`${Math.round(pct)}%`}</td>;
            })}</tr>;
        })}</tbody>
    </table></div>;
}


export function EventResults({ rows, timezone }: { rows: AnalyticsRow[]; timezone: string }) {
    const [selected, setSelected] = useState('');
    const events = [...rows].sort((a,b)=>String(b.first_entry ?? '').localeCompare(String(a.first_entry ?? '')));
    const event = events.find(row=>row.event_subject===selected) ?? events[0];
    const label = (row: AnalyticsRow) => {
        const date = new Date(String(row.first_entry));
        return `${Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString(undefined,{timeZone:timezone,dateStyle:'medium',timeStyle:'short'})} · ${String(row.event_subject ?? '').slice(0,8)}`;
    };
    const attendees = finiteMetric(event?.attendees), seconds = finiteMetric(event?.attendee_seconds);
    return <section aria-label="Event results" className="rounded-xl border border-[var(--lime)]/30 bg-[var(--lime)]/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-semibold">What happened at each event?</h2><p className="mt-1 text-xs text-[var(--text-secondary)]">Observed audience only · Staff and test events excluded.</p></div>
        {event ? <label className="min-w-0 text-sm">Event<select className="mt-1 block max-w-full rounded bg-black/30 p-2" value={String(event.event_subject)} onChange={e=>setSelected(e.target.value)}>{events.map(row=><option key={String(row.event_subject)} value={String(row.event_subject)}>{label(row)}</option>)}</select></label> : null}</div>
        {!event ? <p className="py-6 text-sm">No attendance observed in this range. This does not prove no events were held.</p> : <>
            <div className="my-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[
                ['Attendees',attendees,'Distinct people'],
                ['Time together',seconds===null?null:seconds/3600,'Participant-hours'],
                ['Average presence',attendees && seconds!==null?seconds/attendees/60:null,'Minutes per attendee'],
                ['Reconnections',finiteMetric(event.reconnects),'Reconnects, not affected people'],
            ].map(([title,value,description])=><article key={String(title)}><h3 className="text-sm text-[var(--text-secondary)]">{title}</h3><p className="mt-1 text-3xl font-semibold">{typeof value==='number'?format(value):'—'}</p><p className="text-xs text-[var(--text-secondary)]">{description}</p></article>)}</div>
            <p className="mb-5 text-xs text-[var(--text-secondary)]">Presence totals cover recorded intervals overlapping this range, including their portions outside it. Average presence combines repeat visits; it is not continuous retention. {finiteMetric(event.network_or_crash_exits) ?? 'Unknown'} heartbeat-timeout exits are diagnostic signals, not confirmed crashes. Dates identify first observed entry; event titles are not collected.</p>
            <div className="grid gap-6 lg:grid-cols-2"><div><h3 className="mb-3 text-sm font-medium">Attendance comparison · top 6</h3><RankedBars rows={events.map(row=>({...row,label:label(row)}))} labelKey="label" valueKey="attendees" unit="people"/></div><div><h3 className="mb-3 text-sm font-medium">Average presence comparison · top 6</h3><RankedBars rows={events.map(row=>({label:label(row),minutes:Number(row.attendees)>0 && finiteMetric(row.attendee_seconds)!==null?Number(row.attendee_seconds)/Number(row.attendees)/60:null}))} labelKey="label" valueKey="minutes" unit="min/person"/></div></div>
        </>}
    </section>;
}
