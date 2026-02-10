/**
 * Deterministic gradient class from a string ID (hash-based selection).
 */
export function getGradient(id: string): string {
    const gradients = [
        "from-purple-600 to-blue-600",
        "from-indigo-600 to-purple-800",
        "from-rose-500 to-pink-600",
        "from-emerald-600 to-teal-600",
        "from-amber-500 to-orange-600",
        "from-cyan-500 to-blue-600",
        "from-fuchsia-600 to-purple-600",
        "from-violet-600 to-indigo-600",
    ];
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
        hash = ((hash << 5) - hash) + id.charCodeAt(i);
        hash |= 0;
    }
    return gradients[Math.abs(hash) % gradients.length];
}

/**
 * Format seconds as "M:SS" (no leading zero on minutes).
 */
export function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Format seconds as "MM:SS" (leading zero on minutes).
 */
export function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Format milliseconds as "M:SS".
 */
export function formatTimeMs(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Format an ISO date string as a relative label ("Today", "Yesterday") or short date.
 */
export function formatDate(iso: string): string {
    const date = new Date(iso);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
