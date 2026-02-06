type BadgeState = "live" | "playlist" | "offline";

interface LiveBadgeProps {
    state?: BadgeState;
    /** @deprecated Use `state` instead */
    isLive?: boolean;
    className?: string;
}

export default function LiveBadge({ state, isLive, className = "" }: LiveBadgeProps) {
    // Backwards compat: if state not provided, derive from isLive
    const resolvedState: BadgeState = state ?? (isLive ? "live" : "offline");

    if (resolvedState === "live") {
        return (
            <span className={`live-badge ${className}`}>
                Live
            </span>
        );
    }

    if (resolvedState === "playlist") {
        return (
            <span className={`inline-flex items-center gap-2 px-3 py-1.5 bg-amber-500/20 border border-amber-500/30 rounded-full text-xs font-semibold uppercase tracking-wide text-amber-400 ${className}`}>
                <span className="w-2 h-2 bg-amber-400 rounded-full" />
                Playlist
            </span>
        );
    }

    return (
        <span className={`inline-flex items-center gap-2 px-3 py-1.5 bg-gray-600/50 rounded-full text-xs font-semibold uppercase tracking-wide ${className}`}>
            <span className="w-2 h-2 bg-gray-400 rounded-full" />
            Offline
        </span>
    );
}
