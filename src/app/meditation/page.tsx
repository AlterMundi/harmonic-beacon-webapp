"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { BottomNav, AudioVisualizer } from "@/components";
import { useAudio } from "@/context/AudioContext";
import { getGradient, formatDuration, formatTimeMs } from "@/lib/format";

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
    fileName: string;
    isFeatured: boolean;
    defaultMix: number;
    provider: { name: string | null; avatarUrl: string | null } | null;
    tags: { name: string; slug: string; category: string }[];
}

export default function MeditationPage() {
    const { data: session } = useSession();
    const [meditations, setMeditations] = useState<MeditationItem[]>([]);
    const [tags, setTags] = useState<TagItem[]>([]);
    const [selectedTag, setSelectedTag] = useState<string | null>(null);
    const [showFavorites, setShowFavorites] = useState(false);
    const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const {
        loadMeditationFromGo2rtc,
        loadMeditation,
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
        mixValue,
        setMixValue,
    } = useAudio();

    const formatTime = formatTimeMs;

    // Fetch tags
    useEffect(() => {
        fetch("/api/tags")
            .then((r) => r.json())
            .then((data) => {
                if (data.all) setTags(data.all);
            })
            .catch(() => { });
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
            .catch(() => { });
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



    const startMeditation = async (meditation: MeditationItem) => {
        const fileUrl = `/api/meditations/${meditation.id}/audio`;

        if (currentMeditationFile === fileUrl) {
            toggleMeditation();
        } else {
            // Apply the provider's default mix ratio
            setMixValue(meditation.defaultMix ?? 0.5);
            // Use standard audio loader which supports seeking and duration
            await loadMeditation(fileUrl);
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
        ? meditations.find((m) => `/api/meditations/${m.id}/audio` === currentMeditationFile)
        : null;

    const progress = meditationDuration > 0 ? (meditationPosition / meditationDuration) * 100 : 0;

    // Group tags by category for display
    const tagCategories = tags.reduce<Record<string, TagItem[]>>((acc, tag) => {
        if (!acc[tag.category]) acc[tag.category] = [];
        acc[tag.category].push(tag);
        return acc;
    }, {});

    const displayedMeditations = showFavorites
        ? meditations.filter((m) => favoriteIds.has(m.id))
        : meditations;

    return (
        <main className={`min-h-screen pb-28 ${currentMeditation ? "pt-20" : ""}`}>
            {/* Ambient background */}
            <div className="page-gradient" />

            {/* Header */}
            <header className="relative z-10 p-6 pt-8">
                <h1 className="text-3xl font-bold tracking-tight drop-shadow-md">Meditación</h1>
                <p className="text-white/70 text-sm mt-2 font-medium">
                    Sesiones guiadas sobre la resonancia armónica en vivo
                </p>
            </header>

            {/* Tag Filter Pills */}
            <section className="relative z-10 px-4 mb-6">
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                    <button
                        onClick={() => {
                            setShowFavorites(false);
                            setSelectedTag(null);
                        }}
                        className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all backdrop-blur-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/50 ${!selectedTag && !showFavorites
                            ? "bg-[var(--primary-600)]/80 text-white border border-white/10 shadow-lg shadow-[var(--primary-600)]/20"
                            : "bg-white/5 text-white/70 border border-white/5 hover:bg-white/10"
                            }`}
                    >
                        Todas
                    </button>
                    <button
                        onClick={() => {
                            setShowFavorites(!showFavorites);
                            if (!showFavorites) setSelectedTag(null);
                        }}
                        className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all backdrop-blur-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/50 flex items-center gap-2 ${showFavorites
                            ? "bg-red-500/20 text-red-400 border border-red-500/30 shadow-lg shadow-red-500/10"
                            : "bg-white/5 text-white/70 border border-white/5 hover:bg-white/10"
                            }`}
                    >
                        <svg className="w-4 h-4" fill={showFavorites ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                        </svg>
                        Favoritos
                    </button>
                    {Object.entries(tagCategories).map(([, categoryTags]) =>
                        categoryTags.map((tag) => (
                            <button
                                key={tag.id}
                                onClick={() => setSelectedTag(tag.slug === selectedTag ? null : tag.slug)}
                                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all backdrop-blur-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/50 ${selectedTag === tag.slug
                                    ? "bg-[var(--primary-600)]/80 text-white border border-white/10 shadow-lg shadow-[var(--primary-600)]/20"
                                    : "bg-white/5 text-white/70 border border-white/5 hover:bg-white/10"
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
                <section className="relative z-10 px-4 mb-6 animate-fade-in">
                    <div className="glass-card p-4 border-white/10 bg-black/40">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${getGradient(currentMeditation.id)} flex items-center justify-center shadow-lg`}>
                                    <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M8 5v14l11-7z" />
                                    </svg>
                                </div>
                                <div>
                                    <p className="font-semibold text-white">{currentMeditation.title}</p>
                                    <p className="text-xs text-white/60">
                                        Reproduciendo con beacon en vivo
                                    </p>
                                </div>
                            </div>
                            <AudioVisualizer isPlaying={meditationIsPlaying} bars={4} />
                        </div>

                        {/* Progress bar */}
                        <div className="mt-4 flex items-center gap-3">
                            <span className="text-xs text-white/50 w-10">{formatTime(meditationPosition)}</span>
                            <div
                                className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden cursor-pointer"
                                onClick={handleSeek}
                            >
                                <div
                                    className="h-full bg-gradient-to-r from-[var(--primary-400)] to-[var(--accent-400)] transition-all"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                            <span className="text-xs text-white/50 w-10 text-right">{formatTime(meditationDuration)}</span>
                        </div>

                        {/* Controls */}
                        <div className="mt-4 flex items-center justify-center gap-4">
                            <button
                                onClick={toggleMeditation}
                                aria-label={meditationIsPlaying ? "Pause meditation" : "Play meditation"}
                                className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
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
                                className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                            >
                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                    <rect x="6" y="6" width="12" height="12" rx="1" />
                                </svg>
                            </button>
                        </div>

                        {/* Audio Mix Slider */}
                        <div className="mt-6 pt-4 border-t border-white/5">
                            <p className="text-xs text-white/40 text-center mb-3">Audio Mix</p>
                            <div className="flex items-center gap-3">
                                <span className="text-xs text-white/60">Beacon</span>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={mixValue}
                                    onChange={(e) => setMixValue(parseFloat(e.target.value))}
                                    aria-label="Audio mix: Beacon to Voice balance"
                                    className="flex-1 h-2 bg-white/10 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                                />
                                <span className="text-xs text-white/60">Voice</span>
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
            {!loading && !error && displayedMeditations.length === 0 && (
                <div className="px-4">
                    <div className="glass-card p-6 text-center">
                        <p className="text-[var(--text-muted)]">
                            {showFavorites
                                ? "No favorites yet"
                                : selectedTag
                                    ? "No meditations found for this filter"
                                    : "No meditations available yet"}
                        </p>
                    </div>
                </div>
            )}

            {/* Meditation Cards */}
            {!loading && !error && displayedMeditations.length > 0 && (
                <section className="relative z-10 px-4">
                    <div className="grid gap-3">
                        {displayedMeditations.map((meditation, index) => (
                            <button
                                type="button"
                                key={meditation.id}
                                className={`meditation-card animate-fade-in text-left w-full group ${currentMeditationFile === `/api/meditations/${meditation.id}/audio`
                                    ? "border-primary-500/50 bg-primary-500/10"
                                    : "hover:bg-white/5"
                                    }`}
                                style={{ opacity: 0, animationDelay: `${index * 0.1}s` }}
                                onClick={() => startMeditation(meditation)}
                            >
                                <div className="flex gap-4">
                                    {/* Thumbnail */}
                                    <div className={`w-20 h-20 rounded-xl bg-gradient-to-br ${getGradient(meditation.id)} flex items-center justify-center flex-shrink-0 shadow-lg group-hover:scale-105 transition-transform duration-300`}>
                                        {currentMeditationFile === `/api/meditations/${meditation.id}/audio` && meditationIsPlaying ? (
                                            <AudioVisualizer isPlaying={true} bars={3} />
                                        ) : (
                                            <svg className="w-8 h-8 text-white/80" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
                                            </svg>
                                        )}
                                    </div>

                                    {/* Info */}
                                    <div className="flex-1 relative z-10 min-w-0 py-1">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <h3 className="font-semibold text-white text-base leading-tight">{meditation.title}</h3>
                                                {meditation.provider?.name && (
                                                    <p className="text-xs text-white/50 mt-1">
                                                        {meditation.provider.name}
                                                    </p>
                                                )}
                                                {meditation.description && (
                                                    <p className="text-xs text-white/60 mt-1 truncate">
                                                        {meditation.description}
                                                    </p>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                {/* Favorite button */}
                                                {session?.user && (
                                                    <div
                                                        role="button"
                                                        onClick={(e) => toggleFavorite(e, meditation.id)}
                                                        className="p-1.5 hover:bg-white/10 rounded-full transition-colors z-20"
                                                    >
                                                        <svg
                                                            className={`w-4 h-4 ${favoriteIds.has(meditation.id) ? "text-red-400 fill-red-400" : "text-white/30"}`}
                                                            fill={favoriteIds.has(meditation.id) ? "currentColor" : "none"}
                                                            stroke="currentColor"
                                                            strokeWidth="2"
                                                            viewBox="0 0 24 24"
                                                        >
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                                                        </svg>
                                                    </div>
                                                )}
                                                <span className="text-xs text-white/40 bg-white/5 px-2 py-0.5 rounded-full font-mono">
                                                    {formatDuration(meditation.durationSeconds)}
                                                </span>
                                            </div>
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
