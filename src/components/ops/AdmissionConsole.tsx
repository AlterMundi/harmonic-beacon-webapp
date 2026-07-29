'use client';

/**
 * Client side of /ops/admission: ticket lookup, revoke/rebind with a mandatory
 * reason, batch generation/import, and comp/override issuance.
 *
 * Plaintext codes appear exactly once — in the CSV panel after a generate or
 * comp action. The operator must copy/download it there; it is not stored by
 * the app and cannot be fetched again.
 */

import { useState, type FormEvent } from 'react';

type EventOption = {
    id: string;
    title: string;
    language: string;
    scheduledAt: string;
    attendeeCap: number;
};

type Entitlement = {
    id: string;
    state: string;
    tier: string;
    codeLastFour: string;
    boundEmail: string | null;
    expiresAt: string;
    revokedAt: string | null;
    revocationReason: string | null;
    event: { id: string; title: string; language: string; scheduledAt: string };
};

type Props = {
    role: 'FACILITATOR' | 'OPERATOR' | 'ADMIN';
    events: EventOption[];
};

async function postJson(url: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: response.status, data };
}

function errorMessage(status: number, data: Record<string, unknown>): string {
    const detail = typeof data.message === 'string' ? data.message : 'Unexpected error';
    return `${detail} (HTTP ${status})`;
}

export default function AdmissionConsole({ role, events }: Props) {
    const canMutate = role === 'ADMIN' || role === 'OPERATOR';
    const canBatch = role === 'ADMIN';

    const [query, setQuery] = useState('');
    const [results, setResults] = useState<Entitlement[] | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [failure, setFailure] = useState<string | null>(null);
    const [oneTimeCsv, setOneTimeCsv] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    // Per-row mutation form state, keyed by entitlement id.
    const [reasons, setReasons] = useState<Record<string, string>>({});
    const [emails, setEmails] = useState<Record<string, string>>({});

    // Batch + comp form state.
    const [batchEvent, setBatchEvent] = useState(events[0]?.id ?? '');
    const [batchTier, setBatchTier] = useState('GLOBAL_NORTH');
    const [batchCount, setBatchCount] = useState('10');
    const [importCsv, setImportCsv] = useState('');
    const [compTier, setCompTier] = useState('COMP');
    const [compReason, setCompReason] = useState('');

    function flash(ok: string | null, err: string | null) {
        setNotice(ok);
        setFailure(err);
    }

    async function runLookup(event: FormEvent) {
        event.preventDefault();
        setBusy(true);
        flash(null, null);
        try {
            const response = await fetch(`/api/ops/admission?q=${encodeURIComponent(query)}`);
            const data = await response.json();
            if (!response.ok) {
                flash(null, errorMessage(response.status, data));
                setResults(null);
            } else {
                setResults(data.results as Entitlement[]);
                if ((data.results as Entitlement[]).length === 0) {
                    flash('No matching entitlements.', null);
                }
            }
        } finally {
            setBusy(false);
        }
    }

    async function runEntitlementAction(id: string, action: 'revoke' | 'rebind', email?: string) {
        setBusy(true);
        flash(null, null);
        try {
            const { status, data } = await postJson(`/api/ops/admission/${id}`, {
                action,
                reason: reasons[id] ?? '',
                ...(email !== undefined ? { email } : {}),
            });
            if (status >= 400) {
                flash(null, errorMessage(status, data));
            } else {
                flash(action === 'revoke' ? 'Entitlement revoked.' : 'Binding updated.', null);
                setResults((current) =>
                    current?.map((item) =>
                        item.id === id
                            ? {
                                ...item,
                                state: data.state as string,
                                boundEmail: (data.boundEmail as string | null) ?? item.boundEmail,
                                revokedAt: action === 'revoke' ? new Date().toISOString() : item.revokedAt,
                            }
                            : item,
                    ) ?? null,
                );
            }
        } finally {
            setBusy(false);
        }
    }

    async function runBatch(action: 'generate' | 'import') {
        setBusy(true);
        flash(null, null);
        setOneTimeCsv(null);
        try {
            const body = action === 'generate'
                ? { action, sessionId: batchEvent, tier: batchTier, count: Number(batchCount) }
                : { action, sessionId: batchEvent, tier: batchTier, csv: importCsv };
            const { status, data } = await postJson('/api/ops/admission', body);
            if (status >= 400) {
                flash(null, errorMessage(status, data));
            } else if (action === 'generate') {
                setOneTimeCsv(data.csv as string);
                flash('Batch generated. Copy or download the CSV now — it is shown only once.', null);
            } else {
                flash(`Import complete: ${data.created} created, ${data.skipped} skipped (already existed).`, null);
            }
        } finally {
            setBusy(false);
        }
    }

    async function runComp() {
        setBusy(true);
        flash(null, null);
        setOneTimeCsv(null);
        try {
            const { status, data } = await postJson('/api/ops/admission', {
                action: 'comp',
                sessionId: batchEvent,
                tier: compTier,
                reason: compReason,
            });
            if (status >= 400) {
                flash(null, errorMessage(status, data));
            } else {
                setOneTimeCsv(data.csv as string);
                setCompReason('');
                flash('Comp/override issued. Copy or download the CSV now — it is shown only once.', null);
            }
        } finally {
            setBusy(false);
        }
    }

    function downloadCsv() {
        if (!oneTimeCsv) return;
        const blob = new Blob([oneTimeCsv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `tickets-${new Date().toISOString().slice(0, 19)}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    }

    return (
        <div className="space-y-10">
            <section>
                <h2 className="mb-2 text-lg font-medium">Ticket lookup</h2>
                <form onSubmit={runLookup} className="flex gap-2">
                    <input
                        className="w-full rounded border px-3 py-2"
                        placeholder="Attendee email, code last four, or entitlement ID"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                    />
                    <button
                        type="submit"
                        disabled={busy || !query.trim()}
                        className="rounded bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
                    >
                        Look up
                    </button>
                </form>

                {results && results.length > 0 && (
                    <div className="mt-4 space-y-4">
                        {results.map((item) => (
                            <div key={item.id} className="rounded border p-3 text-sm">
                                <div className="flex flex-wrap gap-x-6 gap-y-1">
                                    <span><strong>State:</strong> {item.state}</span>
                                    <span><strong>Tier:</strong> {item.tier}</span>
                                    <span><strong>Last four:</strong> {item.codeLastFour}</span>
                                    <span><strong>Bound email:</strong> {item.boundEmail ?? '—'}</span>
                                    <span><strong>Event:</strong> {item.event.title}</span>
                                    <span><strong>Expires:</strong> {new Date(item.expiresAt).toLocaleString()}</span>
                                </div>
                                <div className="mt-1 text-xs text-gray-500">ID: {item.id}</div>
                                {item.revokedAt && (
                                    <div className="mt-1 text-xs text-red-700">
                                        Revoked {new Date(item.revokedAt).toLocaleString()} — {item.revocationReason}
                                    </div>
                                )}

                                {canMutate && item.state !== 'REVOKED' && (
                                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                                        <input
                                            className="min-w-56 flex-1 rounded border px-2 py-1"
                                            placeholder="Reason (required, no PII)"
                                            value={reasons[item.id] ?? ''}
                                            onChange={(event) =>
                                                setReasons((current) => ({ ...current, [item.id]: event.target.value }))
                                            }
                                        />
                                        <input
                                            className="min-w-56 flex-1 rounded border px-2 py-1"
                                            placeholder="New email (optional rebind)"
                                            value={emails[item.id] ?? ''}
                                            onChange={(event) =>
                                                setEmails((current) => ({ ...current, [item.id]: event.target.value }))
                                            }
                                        />
                                        <button
                                            type="button"
                                            disabled={busy || !(reasons[item.id] ?? '').trim()}
                                            onClick={() => runEntitlementAction(item.id, 'rebind', emails[item.id] ?? '')}
                                            className="rounded border px-3 py-1 disabled:opacity-50"
                                        >
                                            {(emails[item.id] ?? '').trim() ? 'Rebind to email' : 'Clear binding'}
                                        </button>
                                        <button
                                            type="button"
                                            disabled={busy || !(reasons[item.id] ?? '').trim()}
                                            onClick={() => runEntitlementAction(item.id, 'revoke')}
                                            className="rounded bg-red-700 px-3 py-1 text-white disabled:opacity-50"
                                        >
                                            Revoke
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {(canBatch || canMutate) && (
                <section>
                    <h2 className="mb-2 text-lg font-medium">Issue tickets</h2>
                    <div className="mb-3 flex flex-wrap gap-2">
                        <select
                            className="rounded border px-2 py-1"
                            value={batchEvent}
                            onChange={(event) => setBatchEvent(event.target.value)}
                        >
                            {events.map((event) => (
                                <option key={event.id} value={event.id}>
                                    {event.title} ({event.language}, cap {event.attendeeCap})
                                </option>
                            ))}
                        </select>
                    </div>

                    {canBatch && (
                        <div className="mb-6 space-y-3 rounded border p-3">
                            <h3 className="font-medium">Batch (ADMIN)</h3>
                            <div className="flex flex-wrap items-center gap-2">
                                <select
                                    className="rounded border px-2 py-1"
                                    value={batchTier}
                                    onChange={(event) => setBatchTier(event.target.value)}
                                >
                                    <option value="GLOBAL_NORTH">Global North ($50)</option>
                                    <option value="GLOBAL_SOUTH">Global South ($20)</option>
                                </select>
                                <input
                                    className="w-24 rounded border px-2 py-1"
                                    type="number"
                                    min={1}
                                    max={150}
                                    value={batchCount}
                                    onChange={(event) => setBatchCount(event.target.value)}
                                />
                                <button
                                    type="button"
                                    disabled={busy || !batchEvent}
                                    onClick={() => runBatch('generate')}
                                    className="rounded bg-gray-900 px-3 py-1 text-white disabled:opacity-50"
                                >
                                    Generate batch
                                </button>
                            </div>
                            <textarea
                                className="h-24 w-full rounded border px-2 py-1 font-mono text-xs"
                                placeholder="Paste platform CSV to import (code column, header optional)"
                                value={importCsv}
                                onChange={(event) => setImportCsv(event.target.value)}
                            />
                            <button
                                type="button"
                                disabled={busy || !batchEvent || !importCsv.trim()}
                                onClick={() => runBatch('import')}
                                className="rounded border px-3 py-1 disabled:opacity-50"
                            >
                                Import CSV (idempotent)
                            </button>
                        </div>
                    )}

                    {canMutate && (
                        <div className="space-y-3 rounded border p-3">
                            <h3 className="font-medium">Comp / support override</h3>
                            <div className="flex flex-wrap items-center gap-2">
                                <select
                                    className="rounded border px-2 py-1"
                                    value={compTier}
                                    onChange={(event) => setCompTier(event.target.value)}
                                >
                                    {role === 'ADMIN' && <option value="COMP">Comp</option>}
                                    <option value="SUPPORT_OVERRIDE">Support override</option>
                                </select>
                                <input
                                    className="min-w-56 flex-1 rounded border px-2 py-1"
                                    placeholder="Reason (required, no PII — e.g. support case reference)"
                                    value={compReason}
                                    onChange={(event) => setCompReason(event.target.value)}
                                />
                                <button
                                    type="button"
                                    disabled={busy || !batchEvent || !compReason.trim()}
                                    onClick={runComp}
                                    className="rounded bg-gray-900 px-3 py-1 text-white disabled:opacity-50"
                                >
                                    Issue
                                </button>
                            </div>
                        </div>
                    )}
                </section>
            )}

            {notice && <p className="rounded bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}
            {failure && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">{failure}</p>}

            {oneTimeCsv && (
                <section className="rounded border-2 border-amber-500 p-3">
                    <h3 className="mb-1 font-medium text-amber-800">One-time code export</h3>
                    <p className="mb-2 text-sm text-amber-800">
                        These plaintext codes are shown once and are never stored by the app. Save the CSV
                        under ops control now; do not commit it or paste it into tickets/chat.
                    </p>
                    <textarea
                        readOnly
                        className="h-40 w-full rounded border px-2 py-1 font-mono text-xs"
                        value={oneTimeCsv}
                        onFocus={(event) => event.target.select()}
                    />
                    <button
                        type="button"
                        onClick={downloadCsv}
                        className="mt-2 rounded bg-amber-600 px-3 py-1 text-white"
                    >
                        Download CSV
                    </button>
                </section>
            )}
        </div>
    );
}
