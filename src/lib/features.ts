/**
 * First-iteration feature flags (WS0 — see docs/LAUNCH_PREP_WS0.md).
 *
 * Each public surface is SHOWN by default, so this file is behaviour-preserving:
 * nothing changes until an env var is set. Set the matching var to "off" (also
 * "false" / "0") to HIDE that surface. The public first-iteration launch sets
 * all four to "off".
 *
 * Naming uses NEXT_PUBLIC_* so the SAME value is available in client components,
 * middleware, and route handlers. NEXT_PUBLIC_* is inlined at build time, so
 * flipping a flag requires a rebuild/redeploy — acceptable for a launch posture,
 * not a runtime kill-switch.
 *
 * Nothing here deletes code: re-enabling a surface is a one-line env change.
 */
function shown(v: string | undefined): boolean {
    return v !== 'off' && v !== 'false' && v !== '0';
}

export const features = {
    /** Public beacon / the `/live` home and its play button. */
    showLive: shown(process.env.NEXT_PUBLIC_SHOW_LIVE),
    /** The `/meditation` library (returns later as a documentation gallery). */
    showMeditate: shown(process.env.NEXT_PUBLIC_SHOW_MEDITATE),
    /** The solo "Practice" tab on the Sessions screen. */
    showPractice: shown(process.env.NEXT_PUBLIC_SHOW_PRACTICE),
    /** Provider "Upload Meditation" entry + page. */
    showUpload: shown(process.env.NEXT_PUBLIC_SHOW_UPLOAD),
} as const;
