interface LiveBadgeProps {
    isLive?: boolean;
    className?: string;
}

export default function LiveBadge({ isLive = true, className = "" }: LiveBadgeProps) {
    if (!isLive) {
        return (
            <span className={`inline-flex items-center gap-2 px-3 py-1.5 bg-gray-600/50 rounded-full text-xs font-semibold uppercase tracking-wide ${className}`}>
                <span className="w-2 h-2 bg-gray-400 rounded-full" />
                Offline
            </span>
        );
    }

    return (
        <span className={`live-badge ${className}`}>
            Live
        </span>
    );
}
