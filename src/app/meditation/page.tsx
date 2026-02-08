"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { BottomNav, AudioVisualizer } from "@/components";
import { useAudio } from "@/context/AudioContext";

interface TagItem {
    id: string;
    name: string;
    slug: string;
    category: string;
}

interface MeditationItem {
    id: string;
    title: string;
    description: string | null;
    durationSeconds: number;
    streamName: string;
    isFeatured: boolean;
    provider: { name: string | null; avatarUrl: string | null } | null;
    tags: { name: string; slug: string; category: string }[];
}

// Deterministic gradient from meditation ID
function getGradient(id: string): string {
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

function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function MeditationPage() {
    const { data: session } = useSession();
    const [meditations, setMeditations] = useState<MeditationItem[]>([]);
    const [tags, setTags] = useState<TagItem[]>([]);
    const [selectedTag, setSelectedTag] = useState<string | null>(null);
    const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [mixValue, setMixValue] = useState(0.5);

    const {
        loadMeditationFromGo2rtc,
        unloadMeditation,
        meditationIsPlaying,
        toggleMeditation,
        meditationPosition,
        meditationDuration,
        seekMeditation,
        currentMeditationFile,
        isPlaying,
        togglePlay,
        setVolume,
        setMeditationVolume,
    } = useAudio();

    const formatTime = (ms: number): string => {
        const seconds = Math.floor(ms / 1000);
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, "0")}`;
    };

    // Fetch tags
    useEffect(() => {
        fetch("/api/tags")
            .then((r) => r.json())
            .then((data) => {
                if (data.all) setTags(data.all);
            })
            .catch(() => {});
    }, []);

    // Fetch meditations
    const fetchMeditations = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const url = selectedTag ? `/api/meditations?tag=${selectedTag}` : "/api/meditations";
            const res = await fetch(url);
            if (!res.ok) throw new Error("Failed to load meditations");
            const data = await res.json();
            setMeditations(data.meditations || []);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load meditations");
        } finally {
            setLoading(false);
        }
    }, [selectedTag]);

    useEffect(() => {
        fetchMeditations();
    }, [fetchMeditations]);

    // Fetch favorites
    useEffect(() => {
        if (!session?.user) return;
        fetch("/api/favorites")
            .then((r) => r.json())
            .then((data) => {
                if (data.favorites) {
                    setFavoriteIds(new Set(data.favorites.map((f: { meditationId: string }) => f.meditationId)));
                }
            })
            .catch(() => {});
    }, [session]);

    const toggleFavorite = async (e: React.MouseEvent, meditationId: string) => {
        e.stopPropagation();
        if (!session?.user) return;

        // Optimistic update
        setFavoriteIds((prev) => {
            const next = new Set(prev);
            if (next.has(meditationId)) next.delete(meditationId);
            else next.add(meditationId);
            return next;
        });

        try {
            const res = await fetch("/api/favorites", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ meditationId }),
            });
            if (!res.ok) throw new Error();
        } catch {
            // Revert on failure
            setFavoriteIds((prev) => {
                const next = new Set(prev);
                if (next.has(meditationId)) next.delete(meditationId);
                else next.add(meditationId);
                return next;
            });
        }
    };

    const handleMixChange = (value: number) => {
        setMixValue(value);
        if (value <= 0.5) {
            const beaconVol = 1.0 - (value * 0.3);
            const medVol = value * 2;
            setVolume(beaconVol);
            setMeditationVolume(medVol);
        } else {
            const beaconVol = (1 - value) * 1.7;
            setMeditationVolume(1.0);
            setVolume(beaconVol);
        }
    };

    const startMeditation = async (meditation: MeditationItem) => {
        if (currentMeditationFile === meditation.streamName) {
            toggleMeditation();
        } else {
            const meditationId = meditation.streamName.replace('meditation-', '');
            await loadMeditationFromGo2rtc(meditationId);
        }
    };

    const handleStopMeditation = () => {
        unloadMeditation();
        if (isPlaying) {
            togglePlay();
        }
    };

    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        seekMeditation(percent * meditationDuration);
    };

    const currentMeditation = currentMeditationFile
        ? meditations.find((m) => m.streamName === currentMeditationFile)
        : null;

    const progress = meditationDuration > 0 ? (meditationPosition / meditationDuration) * 100 : 0;

    // Group tags by category for display
    const tagCategories = tags.reduce<Record<string, TagItem[]>>((acc, tag) => {
        if (!acc[tag.category]) acc[tag.category] = [];
        acc[tag.category].push(tag);
        return acc;
    }, {});

    return (
        <main className={`min-h-screen pb-28 ${currentMeditation ? "pt-20" : ""}`}>
            {/* Header */}
            <header className="p-6 pt-8">
                <h1 className="text-2xl font-bold">Meditación</h1>
                <p className="text-[var(--text-secondary)] text-sm mt-1">
                    Sesiones guiadas sobre la resonancia armónica en vivo
                </p>
            </header>

            {/* Tag Filter Pills */}
            <section className="px-4 mb-6">
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                    <button
                        onClick={() => setSelectedTag(null)}
                        className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary-500)] focus-visible:outline-offset-2 ${
                            selectedTag === null
                                ? "bg-[var(--primary-600)] text-white"
                                : "bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-subtle)]"
                        }`}
                    >
                        Todas
                    </button>
                    {Object.entries(tagCategories).map(([, categoryTags]) =>
                        categoryTags.map((tag) => (
                            <button
                                key={tag.id}
                                onClick={() => setSelectedTag(tag.slug === selectedTag ? null : tag.slug)}
                                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary-500)] focus-visible:outline-offset-2 ${
                                    selectedTag === tag.slug
                                        ? "bg-[var(--primary-600)] text-white"
                                        : "bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-subtle)]"
                                }`}
                            >
                                {tag.name}
                            </button>
                        ))
                    )}
                </div>
            </section>

            {/* Now Playing */}
            {currentMeditation && (
                <section className="px-4 mb-6 animate-fade-in">
                    <div className="glass-card p-4 border-[var(--primary-600)]">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${getGradient(currentMeditation.id)} flex items-center justify-center`}>
                                    <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M8 5v14l11-7z" />
                                    </svg>
                                </div>
                                <div>
                                    <p className="font-semibold">{currentMeditation.title}</p>
                                    <p className="text-xs text-[var(--text-muted)]">
                                        Reproduciendo con beacon en vivo
                                    </p>
                                </div>
                            </div>
                            <AudioVisualizer isPlaying={meditationIsPlaying} bars={4} />
                        </div>

                        {/* Progress bar */}
                        <div className="mt-4 flex items-center gap-3">
                            <span className="text-xs text-[var(--text-muted)] w-10">{formatTime(meditationPosition)}</span>
                            <div
                                className="flex-1 h-1.5 bg-[var(--border-subtle)] rounded-full overflow-hidden cursor-pointer"
                                onClick={handleSeek}
                            >
                                <div
                                    className="h-full bg-gradient-to-r from-[var(--primary-500)] to-[var(--primary-400)] transition-all"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                            <span className="text-xs text-[var(--text-muted)] w-10 text-right">{formatTime(meditationDuration)}</span>
                        </div>

                        {/* Controls */}
                        <div className="mt-4 flex items-center justify-center gap-4">
                            <button
                                onClick={toggleMeditation}
                                aria-label={meditationIsPlaying ? "Pause meditation" : "Play meditation"}
                                className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary-500)] focus-visible:outline-offset-2"
                            >
                                {meditationIsPlaying ? (
                                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                        <rect x="6" y="4" width="4" height="16" rx="1" />
                                        <rect x="14" y="4" width="4" height="16" rx="1" />
                                    </svg>
                                ) : (
                                    <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M8 5v14l11-7z" />
                                    </svg>
                                )}
                            </button>
                            <button
                                onClick={handleStopMeditation}
                                aria-label="Stop meditation"
                                className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary-500)] focus-visible:outline-offset-2"
                            >
                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                    <rect x="6" y="6" width="12" height="12" rx="1" />
                                </svg>
                            </button>
                        </div>

                        {/* Audio Mix Slider */}
                        <div className="mt-6 pt-4 border-t border-[var(--border-subtle)]">
                            <p className="text-xs text-[var(--text-muted)] text-center mb-3">Audio Mix</p>
                            <div className="flex items-center gap-3">
                                <span className="text-xs text-[var(--text-secondary)]">Beacon</span>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={mixValue}
                                    onChange={(e) => handleMixChange(parseFloat(e.target.value))}
                                    aria-label="Audio mix: Beacon to Voice balance"
                                    className="flex-1 h-2 bg-[var(--border-subtle)] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                                />
                                <span className="text-xs text-[var(--text-secondary)]">Voice</span>
                            </div>
                        </div>
                    </div>
                </section>
            )}

            {/* Loading State */}
            {loading && (
                <div className="flex items-center justify-center py-12">
                    <div className="animate-spin w-8 h-8 border-2 border-[var(--primary-500)] border-t-transparent rounded-full"></div>
                </div>
            )}

            {/* Error State */}
            {error && !loading && (
                <div className="px-4 mb-6">
                    <div className="glass-card p-6 text-center">
                        <p className="text-red-400 mb-3">{error}</p>
                        <button onClick={fetchMeditations} className="btn-secondary text-sm">
                            <span>Retry</span>
                        </button>
                    </div>
                </div>
            )}

            {/* Empty State */}
            {!loading && !error && meditations.length === 0 && (
                <div className="px-4">
                    <div className="glass-card p-6 text-center">
                        <p className="text-[var(--text-muted)]">
                            {selectedTag ? "No meditations found for this filter" : "No meditations available yet"}
                        </p>
                    </div>
                </div>
            )}

            {/* Meditation Cards */}
            {!loading && !error && meditations.length > 0 && (
                <section className="px-4">
                    <div className="grid gap-4">
                        {meditations.map((meditation, index) => (
                            <button
                                type="button"
                                key={meditation.id}
                                className={`meditation-card animate-fade-in text-left w-full ${
                                    currentMeditationFile === meditation.streamName ? "border-[var(--primary-500)]" : ""
                                }`}
                                style={{ opacity: 0, animationDelay: `${index * 0.1}s` }}
                                onClick={() => startMeditation(meditation)}
                            >
                                <div className="flex gap-4">
                                    {/* Thumbnail */}
                                    <div className={`w-20 h-20 rounded-xl bg-gradient-to-br ${getGradient(meditation.id)} flex items-center justify-center flex-shrink-0`}>
                                        {currentMeditationFile === meditation.streamName && meditationIsPlaying ? (
                                            <AudioVisualizer isPlaying={true} bars={3} />
                                        ) : (
                                            <svg className="w-8 h-8 text-white/80" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
                                            </svg>
                                        )}
                                    </div>

                                    {/* Info */}
                                    <div className="flex-1 relative z-10 min-w-0">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <h3 className="font-semibold text-lg">{meditation.title}</h3>
                                                {meditation.provider?.name && (
                                                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                                                        {meditation.provider.name}
                                                    </p>
                                                )}
                                                {meditation.description && (
                                                    <p className="text-sm text-[var(--text-muted)] mt-1 truncate">
                                                        {meditation.description}
                                                    </p>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                {/* Favorite button */}
                                                {session?.user && (
                                                    <button
                                                        onClick={(e) => toggleFavorite(e, meditation.id)}
                                                        aria-label={favoriteIds.has(meditation.id) ? "Unfavorite" : "Favorite"}
                                                        className="p-1 hover:bg-white/10 rounded-full transition-colors"
                                                    >
                                                        <svg
                                                            className={`w-5 h-5 ${favoriteIds.has(meditation.id) ? "text-red-400 fill-red-400" : "text-[var(--text-muted)]"}`}
                                                            fill={favoriteIds.has(meditation.id) ? "currentColor" : "none"}
                                                            stroke="currentColor"
                                                            strokeWidth="2"
                                                            viewBox="0 0 24 24"
                                                        >
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                                                        </svg>
                                                    </button>
                                                )}
                                                <span className="text-xs text-[var(--text-muted)] bg-white/5 px-2 py-1 rounded-full">
                                                    {formatDuration(meditation.durationSeconds)}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 mt-3 flex-wrap">
                                            {meditation.tags.slice(0, 3).map((tag) => (
                                                <span
                                                    key={tag.slug}
                                                    className="text-xs px-2 py-0.5 rounded-full bg-[var(--primary-700)]/30 text-[var(--primary-300)]"
                                                >
                                                    {tag.name}
                                                </span>
                                            ))}
                                            {meditation.isFeatured && (
                                                <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--accent-500)]/20 text-[var(--accent-400)]">
                                                    Featured
                                                </span>
                                            )}
                                            <span className="text-xs text-[var(--text-muted)]">+ Beacon en vivo</span>
                                        </div>
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                </section>
            )}

            <BottomNav />
        </main>
    );
}
