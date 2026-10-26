export type PresenceWindow = { startedAt: Date; lastHeartbeatAt: Date; endedAt: Date | null };

/** Union simultaneous devices/rooms and stop stale open intervals at heartbeat
 * expiry. Values are server-observed; the browser never supplies elapsed time. */
export function measuredPresenceSeconds(windows: PresenceWindow[], now: Date, graceMs = 45_000): number {
    const spans = windows.map(window => [window.startedAt.getTime(), Math.min(
        now.getTime(), window.endedAt?.getTime() ?? Infinity, window.lastHeartbeatAt.getTime() + graceMs,
    )]).filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
        .sort((a, b) => a[0] - b[0]);
    let seconds = 0;
    let from = 0;
    let through = 0;
    for (const [start, end] of spans) {
        if (start > through) { seconds += Math.max(0, through - from); from = start; through = end; }
        else through = Math.max(through, end);
    }
    return Math.floor((seconds + Math.max(0, through - from)) / 1000);
}
