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
import type { StaffRole } from '@prisma/client';

import { hasStaffCapability } from '@/lib/staff-capabilities';

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
    commerce: {
        provider: 'TICKET_TAILOR';
        providerState: 'ACTIVE' | 'REVOKED';
        administrativeState: 'CLEAR' | 'SUSPENDED';
        mediaStatus: string;
    } | null;
    promotion: {
        campaignId: string;
        label: string;
        status: 'ACTIVE' | 'DISABLED';
        expiresAt: string;
        redeemedAt: string;
    } | null;
};

type PromoCampaign = {
    id: string;
    label: string;
    status: 'ACTIVE' | 'DISABLED';
    expiresAt: string;
    maxRedemptions: number;
    redemptionCount: number;
    disabledAt: string | null;
    event: { id: string; title: string; language: string; scheduledAt: string };
};

type Props = {
    role: StaffRole;
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
    const canMutate = hasStaffCapability(role, 'mutate_entitlement');
    const canBatch = hasStaffCapability(role, 'manage_ticket_batches');
    const canIssueComp = hasStaffCapability(role, 'issue_comp');

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
    const [compTier, setCompTier] = useState(canIssueComp ? 'COMP' : 'SUPPORT_OVERRIDE');
    const [compReason, setCompReason] = useState('');
    const [promoCampaigns, setPromoCampaigns] = useState<PromoCampaign[] | null>(null);
    const [promoRedemptionEnabled, setPromoRedemptionEnabled] = useState<boolean | null>(null);
    const [promoCode, setPromoCode] = useState('');
    const [promoLabel, setPromoLabel] = useState('');
    const [promoExpiry, setPromoExpiry] = useState('');
    const [promoCapacity, setPromoCapacity] = useState('1');
    const [promoReasons, setPromoReasons] = useState<Record<string, string>>({});
    const [promoRevokeDerived, setPromoRevokeDerived] = useState<Record<string, boolean>>({});

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

    async function runEntitlementAction(id: string, action: 'revoke' | 'rebind' | 'resume', email?: string) {
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
                flash(
                    action === 'revoke'
                        ? 'Access suspended or revoked.'
                        : action === 'resume'
                            ? 'Administrative suspension cleared.'
                            : 'Binding updated.',
                    null,
                );
                setResults((current) =>
                    current?.map((item) =>
                        item.id === id
                            ? {
                                ...item,
                                state: data.state as string,
                                boundEmail: (data.boundEmail as string | null) ?? item.boundEmail,
                                revokedAt: action === 'revoke'
                                    ? new Date().toISOString()
                                    : action === 'resume'
                                        ? null
                                        : item.revokedAt,
                                commerce: item.commerce ? {
                                    ...item.commerce,
                                    administrativeState: action === 'resume' ? 'CLEAR' :
                                        action === 'revoke' ? 'SUSPENDED' : item.commerce.administrativeState,
                                } : null,
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

    async function loadPromoCampaigns() {
        setBusy(true);
        flash(null, null);
        try {
            const response = await fetch('/api/ops/invitations');
            const data = await response.json() as Record<string, unknown>;
            if (!response.ok) {
                flash(null, errorMessage(response.status, data));
                return;
            }
            setPromoCampaigns(data.campaigns as PromoCampaign[]);
            setPromoRedemptionEnabled(Boolean(data.redemptionEnabled));
        } finally {
            setBusy(false);
        }
    }

    async function createPromoCampaign() {
        setBusy(true);
        flash(null, null);
        try {
            const { status, data } = await postJson('/api/ops/invitations', {
                sessionId: batchEvent,
                code: promoCode,
                label: promoLabel,
                expiresAt: new Date(promoExpiry).toISOString(),
                maxRedemptions: Number(promoCapacity),
            });
            if (status >= 400) {
                flash(null, errorMessage(status, data));
                return;
            }
            const campaign = data.campaign as PromoCampaign;
            setPromoCampaigns((current) => [campaign, ...(current ?? [])]);
            setPromoRedemptionEnabled(Boolean(data.redemptionEnabled));
            setPromoCode('');
            setPromoLabel('');
            flash(
                data.redemptionEnabled
                    ? 'Invitation created and ready to redeem.'
                    : 'Invitation created, but the global redemption switch remains OFF.',
                null,
            );
        } finally {
            setBusy(false);
        }
    }

    async function disablePromoCampaign(id: string) {
        setBusy(true);
        flash(null, null);
        try {
            const { status, data } = await postJson(`/api/ops/invitations/${id}`, {
                action: 'disable',
                reason: promoReasons[id] ?? '',
                revokeDerived: promoRevokeDerived[id] ?? false,
            });
            if (status >= 400) {
                flash(null, errorMessage(status, data));
                return;
            }
            setPromoCampaigns((current) => current?.map((campaign) =>
                campaign.id === id
                    ? { ...campaign, status: 'DISABLED', disabledAt: new Date().toISOString() }
                    : campaign,
            ) ?? null);
            flash(
                data.mediaCleanupFailed
                    ? 'Invitation disabled and access revoked; some live connections need a retry.'
                    : `Invitation disabled. ${data.revokedEntitlements} derived access grant(s) revoked.`,
                null,
            );
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
                <h2 className="mb-2 text-lg font-medium text-[var(--cream)]">Ticket lookup</h2>
                <form onSubmit={runLookup} className="flex gap-2">
                    <input
                        className="event-field flex-1"
                        placeholder="Attendee email, code last four, or entitlement ID"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                    />
                    <button
                        type="submit"
                        disabled={busy || !query.trim()}
                        className="event-button event-button--primary"
                    >
                        Look up
                    </button>
                </form>

                {results && results.length > 0 && (
                    <div className="mt-4 space-y-4">
                        {results.map((item) => (
                            <div key={item.id} className="operational-panel text-sm">
                                <div className="flex flex-wrap gap-x-6 gap-y-1">
                                    <span><strong className="text-[var(--cream)]">State:</strong> {item.state}</span>
                                    <span><strong className="text-[var(--cream)]">Tier:</strong> {item.tier}</span>
                                    <span><strong className="text-[var(--cream)]">Last four:</strong> <span className="font-mono">{item.codeLastFour}</span></span>
                                    <span><strong className="text-[var(--cream)]">Bound email:</strong> {item.boundEmail ?? '—'}</span>
                                    <span><strong className="text-[var(--cream)]">Event:</strong> {item.event.title}</span>
                                    <span><strong className="text-[var(--cream)]">Expires:</strong> {new Date(item.expiresAt).toLocaleString()}</span>
                                    {item.commerce && (
                                        <span>
                                            <strong className="text-[var(--cream)]">Commerce:</strong>{' '}
                                            {item.commerce.providerState} · admin {item.commerce.administrativeState} · media {item.commerce.mediaStatus}
                                        </span>
                                    )}
                                    {item.promotion && (
                                        <span>
                                            <strong className="text-[var(--cream)]">Invitation:</strong>{' '}
                                            {item.promotion.label} · campaign {item.promotion.status} · redeemed{' '}
                                            {new Date(item.promotion.redeemedAt).toLocaleString()}
                                        </span>
                                    )}
                                </div>
                                <div className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">ID: {item.id}</div>
                                {item.revokedAt && (
                                    <div className="mt-1 text-xs text-[var(--danger)]">
                                        Revoked {new Date(item.revokedAt).toLocaleString()} — {item.revocationReason}
                                    </div>
                                )}

                                {canMutate && (item.state !== 'REVOKED' || item.commerce !== null) && (
                                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
                                        <input
                                            className="event-field min-w-56 flex-1"
                                            placeholder="Reason (required, no PII)"
                                            value={reasons[item.id] ?? ''}
                                            onChange={(event) =>
                                                setReasons((current) => ({ ...current, [item.id]: event.target.value }))
                                            }
                                        />
                                        {!item.commerce && (
                                            <>
                                                <input
                                                    className="event-field min-w-56 flex-1"
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
                                                    className="event-button event-button--secondary disabled:opacity-50"
                                                >
                                                    {(emails[item.id] ?? '').trim() ? 'Rebind to email' : 'Clear binding'}
                                                </button>
                                            </>
                                        )}
                                        {item.commerce?.administrativeState === 'SUSPENDED' ? (
                                            <button
                                                type="button"
                                                disabled={busy || !(reasons[item.id] ?? '').trim()}
                                                onClick={() => runEntitlementAction(item.id, 'resume')}
                                                className="event-button event-button--primary disabled:opacity-50"
                                            >
                                                Resume access
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                disabled={busy || !(reasons[item.id] ?? '').trim()}
                                                onClick={() => runEntitlementAction(item.id, 'revoke')}
                                                className="event-button bg-[var(--danger)] text-white hover:bg-[var(--danger)]/80 disabled:opacity-50"
                                            >
                                                {item.commerce ? 'Suspend access' : 'Revoke'}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {(canBatch || canMutate) && (
                <section>
                    <h2 className="mb-2 text-lg font-medium text-[var(--cream)]">Issue tickets</h2>
                    <div className="mb-3 flex flex-wrap gap-2">
                        <select
                            className="event-field"
                            aria-label="Event"
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
                        <div className="operational-panel mb-6 space-y-3">
                            <h3 className="font-medium text-[var(--cream)]">Batch (ADMIN)</h3>
                            <div className="flex flex-wrap items-center gap-2">
                                <select
                                    className="event-field"
                                    aria-label="Ticket tier"
                                    value={batchTier}
                                    onChange={(event) => setBatchTier(event.target.value)}
                                >
                                    <option value="GLOBAL_NORTH">Global North ($50)</option>
                                    <option value="GLOBAL_SOUTH">Global South ($20)</option>
                                </select>
                                <input
                                    className="event-field w-24"
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
                                    className="event-button event-button--primary disabled:opacity-50"
                                >
                                    Generate batch
                                </button>
                            </div>
                            <textarea
                                className="event-field h-24 font-mono text-xs"
                                placeholder="Paste platform CSV to import (code column, header optional)"
                                value={importCsv}
                                onChange={(event) => setImportCsv(event.target.value)}
                            />
                            <button
                                type="button"
                                disabled={busy || !batchEvent || !importCsv.trim()}
                                onClick={() => runBatch('import')}
                                className="event-button event-button--secondary disabled:opacity-50"
                            >
                                Import CSV (idempotent)
                            </button>
                        </div>
                    )}

                    {canMutate && (
                        <div className="operational-panel space-y-3">
                            <h3 className="font-medium text-[var(--cream)]">Comp / support override</h3>
                            <div className="flex flex-wrap items-center gap-2">
                                <select
                                    className="event-field"
                                    aria-label="Override tier"
                                    value={compTier}
                                    onChange={(event) => setCompTier(event.target.value)}
                                >
                                    {canIssueComp && <option value="COMP">Comp</option>}
                                    <option value="SUPPORT_OVERRIDE">Support override</option>
                                </select>
                                <input
                                    className="event-field min-w-56 flex-1"
                                    placeholder="Reason (required, no PII — e.g. support case reference)"
                                    value={compReason}
                                    onChange={(event) => setCompReason(event.target.value)}
                                />
                                <button
                                    type="button"
                                    disabled={busy || !batchEvent || !compReason.trim()}
                                    onClick={runComp}
                                    className="event-button event-button--primary disabled:opacity-50"
                                >
                                    Issue
                                </button>
                            </div>
                        </div>
                    )}
                </section>
            )}

            {(canIssueComp || canMutate) && (
                <section aria-labelledby="promo-invitations-heading">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h2 id="promo-invitations-heading" className="text-lg font-medium text-[var(--cream)]">
                                Controlled invitations
                            </h2>
                            <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--text-secondary)]">
                                A short code creates the same session-scoped COMP entitlement as normal admission.
                                Codes are stored only as digests; capacity, expiry and revocation remain enforced.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={loadPromoCampaigns}
                            disabled={busy}
                            className="event-button event-button--secondary disabled:opacity-50"
                        >
                            {promoCampaigns === null ? 'Load invitations' : 'Refresh'}
                        </button>
                    </div>

                    {promoRedemptionEnabled !== null && (
                        <p
                            role="status"
                            className={`mb-3 rounded border px-3 py-2 text-sm ${promoRedemptionEnabled
                                ? 'border-[var(--lime)]/30 bg-[var(--lime)]/10 text-[var(--lime)]'
                                : 'border-[var(--warning)]/30 bg-[var(--warning)]/10 text-[var(--warning)]'}`}
                        >
                            Public redemption is {promoRedemptionEnabled ? 'ON' : 'OFF'}.
                        </p>
                    )}

                    {canIssueComp && (
                        <div className="operational-panel mb-4 space-y-3">
                            <h3 className="font-medium text-[var(--cream)]">Create bounded invitation</h3>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <label className="text-xs text-[var(--text-secondary)]">
                                    Internal label (never the code)
                                    <input
                                        className="event-field mt-1"
                                        value={promoLabel}
                                        maxLength={80}
                                        onChange={(event) => setPromoLabel(event.target.value)}
                                        placeholder="Guest list — morning ES"
                                    />
                                </label>
                                <label className="text-xs text-[var(--text-secondary)]">
                                    Human code (6–15 characters)
                                    <input
                                        className="event-field mt-1 font-mono uppercase"
                                        value={promoCode}
                                        maxLength={15}
                                        autoComplete="off"
                                        spellCheck={false}
                                        onChange={(event) => setPromoCode(event.target.value)}
                                        placeholder="NICO100"
                                    />
                                </label>
                                <label className="text-xs text-[var(--text-secondary)]">
                                    Expires (within seven days)
                                    <input
                                        className="event-field mt-1"
                                        type="datetime-local"
                                        value={promoExpiry}
                                        onChange={(event) => setPromoExpiry(event.target.value)}
                                    />
                                </label>
                                <label className="text-xs text-[var(--text-secondary)]">
                                    Redemption capacity
                                    <input
                                        className="event-field mt-1"
                                        type="number"
                                        min={1}
                                        max={150}
                                        value={promoCapacity}
                                        onChange={(event) => setPromoCapacity(event.target.value)}
                                    />
                                </label>
                            </div>
                            <button
                                type="button"
                                disabled={busy || !batchEvent || !promoLabel.trim() || !promoCode.trim() || !promoExpiry}
                                onClick={createPromoCampaign}
                                className="event-button event-button--primary disabled:opacity-50"
                            >
                                Create invitation
                            </button>
                        </div>
                    )}

                    {promoCampaigns && (
                        <div className="space-y-3">
                            {promoCampaigns.length === 0 && (
                                <p className="text-sm text-[var(--text-secondary)]">No invitations created.</p>
                            )}
                            {promoCampaigns.map((campaign) => (
                                <article key={campaign.id} className="operational-panel text-sm">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                            <strong className="text-[var(--cream)]">{campaign.label}</strong>
                                            <p className="mt-1 text-xs text-[var(--text-secondary)]">
                                                {campaign.event.title} · {campaign.redemptionCount}/{campaign.maxRedemptions} redeemed · expires {new Date(campaign.expiresAt).toLocaleString()}
                                            </p>
                                        </div>
                                        <span className="font-mono text-xs text-[var(--gold)]">{campaign.status}</span>
                                    </div>
                                    {canMutate && (campaign.status === 'ACTIVE' || campaign.redemptionCount > 0) && (
                                        <div className="mt-3 space-y-2 border-t border-[var(--border-subtle)] pt-3">
                                            <input
                                                className="event-field"
                                                placeholder="Disable reason (required, no PII)"
                                                value={promoReasons[campaign.id] ?? ''}
                                                onChange={(event) => setPromoReasons((current) => ({
                                                    ...current,
                                                    [campaign.id]: event.target.value,
                                                }))}
                                            />
                                            <label className="flex min-h-11 items-center gap-2 text-xs text-[var(--text-secondary)]">
                                                <input
                                                    type="checkbox"
                                                    checked={promoRevokeDerived[campaign.id] ?? false}
                                                    onChange={(event) => setPromoRevokeDerived((current) => ({
                                                        ...current,
                                                        [campaign.id]: event.target.checked,
                                                    }))}
                                                />
                                                Also revoke every entitlement already redeemed and disconnect its live media.
                                            </label>
                                            <button
                                                type="button"
                                                disabled={
                                                    busy ||
                                                    !(promoReasons[campaign.id] ?? '').trim() ||
                                                    (campaign.status === 'DISABLED' && !(promoRevokeDerived[campaign.id] ?? false))
                                                }
                                                onClick={() => disablePromoCampaign(campaign.id)}
                                                className="event-button bg-[var(--danger)] text-white hover:bg-[var(--danger)]/80 disabled:opacity-50"
                                            >
                                                {campaign.status === 'ACTIVE'
                                                    ? 'Disable invitation'
                                                    : 'Retry revoke / disconnect'}
                                            </button>
                                        </div>
                                    )}
                                </article>
                            ))}
                        </div>
                    )}
                </section>
            )}

            {notice && <p className="rounded border border-[var(--lime)]/30 bg-[var(--lime)]/10 px-3 py-2 text-sm text-[var(--lime)]">{notice}</p>}
            {failure && <p className="rounded border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">{failure}</p>}

            {oneTimeCsv && (
                <section className="rounded border-2 border-[var(--warning)] p-3">
                    <h3 className="mb-1 font-medium text-[var(--warning)]">One-time code export</h3>
                    <p className="mb-2 text-sm text-[var(--warning)]">
                        These plaintext codes are shown once and are never stored by the app. Save the CSV
                        under ops control now; do not commit it or paste it into tickets/chat.
                    </p>
                    <textarea
                        readOnly
                        className="event-field h-40 font-mono text-xs"
                        value={oneTimeCsv}
                        onFocus={(event) => event.target.select()}
                    />
                    <button
                        type="button"
                        onClick={downloadCsv}
                        className="event-button mt-2 bg-[var(--warning)] text-[var(--ink)] hover:bg-[var(--warning)]/80"
                    >
                        Download CSV
                    </button>
                </section>
            )}
        </div>
    );
}
