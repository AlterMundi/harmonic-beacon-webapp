interface AudioVisualizerProps {
    isPlaying?: boolean;
    bars?: number;
    className?: string;
}

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
                        height: `${40 + Math.random() * 60}%`,
                        animationDelay: `${i * 0.1}s`,
                    }}
                />
            ))}
        </div>
    );
}
