"use client";

/**
 * E2E test dashboard — TEMPORARY, test-window only.
 *
 * One-click impersonation for the crew: pick a display name, a role and a
 * landing page; the API mints a real session cookie and we navigate there.
 * The API is gated behind E2E_DASHBOARD_ENABLED=1 and 404s otherwise.
 */

import { useState } from "react";

const TEST_SESSION_ID = "10000000-0000-4000-8000-000000000101";

const LANDING_PRESETS = [
    { label: "Sala ES (asistente/facilitador)", path: `/session/${TEST_SESSION_ID}` },
    { label: "Ops — sala ES", path: `/ops/session/${TEST_SESSION_ID}` },
    { label: "Ops — admission", path: "/ops/admission" },
    { label: "Ops — health", path: "/ops/health" },
    { label: "Landing", path: "/" },
    { label: "Login asistente", path: "/login" },
];

const ROLES = ["ATTENDEE", "FACILITATOR", "FACILITATOR_OP", "OPERATOR", "ADMIN"] as const;

export default function TestLoginPage() {
    const [name, setName] = useState("");
    const [role, setRole] = useState<(typeof ROLES)[number]>("ATTENDEE");
    const [preset, setPreset] = useState(LANDING_PRESETS[0].path);
    const [custom, setCustom] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const landing = custom.trim().length > 0 ? custom.trim() : preset;

    async function enter() {
        setBusy(true);
        setError(null);
        try {
            const res = await fetch("/api/test-login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, role, landing }),
            });
            const data = (await res.json()) as { ok?: boolean; error?: string };
            if (!res.ok || !data.ok) {
                setError(data.error ?? `HTTP ${res.status}`);
                setBusy(false);
                return;
            }
            window.location.assign(landing);
        } catch {
            setError("Network error");
            setBusy(false);
        }
    }

    return (
        <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 bg-[#07120f] px-6 py-12 text-[#fff9e9]">
            <header>
                <p className="text-xs uppercase tracking-widest text-amber-200/70">
                    E2E test dashboard — temporal
                </p>
                <h1 className="mt-1 font-serif text-2xl">Entrar como…</h1>
            </header>

            <label className="flex flex-col gap-1 text-sm">
                Nombre para mostrar
                <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ej: Ani, Nico, Oliva"
                    className="rounded border border-white/20 bg-white/5 px-3 py-2 text-base outline-none focus:border-amber-200/60"
                />
            </label>

            <fieldset className="flex flex-col gap-2 text-sm">
                <legend className="mb-1">Rol</legend>
                <div className="grid grid-cols-2 gap-2">
                    {ROLES.map((r) => (
                        <button
                            key={r}
                            type="button"
                            aria-pressed={role === r}
                            onClick={() => setRole(r)}
                            className={`rounded border px-3 py-2 text-left text-sm transition-colors ${
                                role === r
                                    ? "border-amber-200/70 bg-amber-200/10"
                                    : "border-white/15 bg-white/5 hover:bg-white/10"
                            }`}
                        >
                            {r}
                        </button>
                    ))}
                </div>
            </fieldset>

            <label className="flex flex-col gap-1 text-sm">
                Página de aterrizaje
                <select
                    value={preset}
                    onChange={(e) => setPreset(e.target.value)}
                    className="rounded border border-white/20 bg-[#0d211a] px-3 py-2 text-base outline-none"
                >
                    {LANDING_PRESETS.map((p) => (
                        <option key={p.path} value={p.path}>
                            {p.label} — {p.path}
                        </option>
                    ))}
                </select>
                <input
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    placeholder="…o path custom (ej: /ops/health)"
                    className="mt-1 rounded border border-white/20 bg-white/5 px-3 py-2 text-base outline-none focus:border-amber-200/60"
                />
            </label>

            {error && (
                <p role="alert" className="rounded border border-red-400/40 bg-red-400/10 px-3 py-2 text-sm text-red-200">
                    {error}
                </p>
            )}

            <button
                type="button"
                onClick={enter}
                disabled={busy || name.trim().length === 0}
                aria-busy={busy}
                className="rounded bg-amber-200 px-4 py-3 text-base font-medium text-[#07120f] transition-opacity disabled:opacity-40"
            >
                {busy ? "Entrando…" : `Entrar como ${role.toLowerCase()} →`}
            </button>

            <p className="text-xs text-white/40">
                Crea una sesión real con el nombre y rol elegidos (attendee crea un
                ticket BOUND ad-hoc en la sala ES de test; facilitator reusa el
                usuario fixture). Solo activo mientras E2E_DASHBOARD_ENABLED=1.
            </p>
        </main>
    );
}
