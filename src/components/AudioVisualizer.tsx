interface AudioVisualizerProps {
    isPlaying?: boolean;
    bars?: number;
    className?: string;
}

// Deterministic heights based on index to avoid impure Math.random during render
const BAR_HEIGHTS = [70, 85, 55, 95, 60, 80, 50, 90, 65, 75];

export default function AudioVisualizer({
    isPlaying = true,
    bars = 5,
    className = ""
}: AudioVisualizerProps) {
    return (
        <div className={`audio-bars ${className}`}>
            {Array.from({ length: bars }).map((_, i) => (
                <div
                    key={i}
                    className="audio-bar"
                    style={{
                        animationPlayState: isPlaying ? "running" : "paused",
                        height: `${BAR_HEIGHTS[i % BAR_HEIGHTS.length]}%`,
                        animationDelay: `${i * 0.1}s`,
                    }}
                />
            ))}
        </div>
    );
}
