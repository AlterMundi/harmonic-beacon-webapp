"use client";

import { useState, useEffect } from "react";
import { BottomNav, AudioVisualizer } from "@/components";
import { useAudio } from "@/context/AudioContext";

interface Meditation {
    id: string;
    title: string;
    description: string;
    duration: string;
    category: string;
    imageGradient: string;
    audioFile: string;
}

const meditations: Meditation[] = [
    {
        id: "1",
        title: "La Mosca",
        description: "Una guía para soltar y relajarse profundamente",
        duration: "0:52",
        category: "Spanish",
        imageGradient: "from-purple-600 to-blue-600",
        audioFile: "/audio/meditations/la_mosca.m4a",
    },
    {
        id: "2",
        title: "Humanosfera",
        description: "Conecta con la esencia de la humanidad",
        duration: "2:03",
        category: "Spanish",
        imageGradient: "from-indigo-600 to-purple-800",
        audioFile: "/audio/meditations/humanosfera.m4a",
    },
    {
        id: "3",
        title: "El Amor",
        description: "Abre el corazón y encuentra paz interior",
        duration: "4:35",
        category: "Spanish",
        imageGradient: "from-rose-500 to-pink-600",
        audioFile: "/audio/meditations/amor.m4a",
    },
];

const categories = ["All", "Spanish", "English"];

export default function MeditationPage() {
    const [selectedCategory, setSelectedCategory] = useState("All");
    const [mixValue, setMixValue] = useState(0.5); // 0 = beacon only, 1 = meditation only

    const {
        loadMeditation,
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
        volume,
        setVolume,
        meditationVolume,
        setMeditationVolume,
    } = useAudio();

    const formatTime = (ms: number): string => {
        const seconds = Math.floor(ms / 1000);
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, "0")}`;
    };

    // Handle mix slider - similar to mobile app logic
    const handleMixChange = (value: number) => {
        setMixValue(value);
        if (value <= 0.5) {
            // 0 -> Beacon 1.0, Med 0.0
            // 0.5 -> Beacon 0.85, Med 1.0
            const beaconVol = 1.0 - (value * 0.3);
            const medVol = value * 2;
            setVolume(beaconVol);
            setMeditationVolume(medVol);
        } else {
            // 0.5 -> Med 1.0, Beacon 0.85
            // 1.0 -> Med 1.0, Beacon 0.0
            const beaconVol = (1 - value) * 1.7;
            setMeditationVolume(1.0);
            setVolume(beaconVol);
        }
    };

    const startMeditation = async (meditation: Meditation) => {
        const meditationId = meditation.audioFile.replace('/audio/meditations/', '').replace('.m4a', '');
        const streamName = `meditation-${meditationId}`;

        if (currentMeditationFile === streamName) {
            toggleMeditation();
        } else {
            // Use go2rtc WebRTC streaming
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

    const filteredMeditations = selectedCategory === "All"
        ? meditations
        : meditations.filter((m) => m.category === selectedCategory);

    const currentMeditation = currentMeditationFile
        ? meditations.find(m => m.audioFile === currentMeditationFile)
        : null;

    const progress = meditationDuration > 0 ? (meditationPosition / meditationDuration) * 100 : 0;

    return (
        <main className={`min-h-screen pb-28 ${currentMeditation ? 'pt-20' : ''}`}>
            {/* Header */}
            <header className="p-6 pt-8">
                <h1 className="text-2xl font-bold">Meditación</h1>
                <p className="text-[var(--text-secondary)] text-sm mt-1">
                    Sesiones guiadas sobre la resonancia armónica en vivo
                </p>
            </header>

            {/* Category Pills */}
            <section className="px-4 mb-6">
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                    {categories.map((category) => (
                        <button
                            key={category}
                            onClick={() => setSelectedCategory(category)}
                            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary-500)] focus-visible:outline-offset-2 ${selectedCategory === category
                                ? "bg-[var(--primary-600)] text-white"
                                : "bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-subtle)]"
                                }`}
                        >
                            {category === "All" ? "Todas" : category}
                        </button>
                    ))}
                </div>
            </section>

            {/* Now Playing */}
            {currentMeditation && (
                <section className="px-4 mb-6 animate-fade-in">
                    <div className="glass-card p-4 border-[var(--primary-600)]">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${currentMeditation.imageGradient} flex items-center justify-center`}>
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
                                <span className="text-xs text-[var(--text-secondary)]">🎸 Beacon</span>
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
                                <span className="text-xs text-[var(--text-secondary)]">🧘 Voice</span>
                            </div>
                        </div>
                    </div>
                </section>
            )}

            {/* Meditation Cards */}
            <section className="px-4">
                <div className="grid gap-4">
                    {filteredMeditations.map((meditation, index) => (
                        <button
                            type="button"
                            key={meditation.id}
                            className={`meditation-card animate-fade-in text-left w-full ${currentMeditationFile === meditation.audioFile ? 'border-[var(--primary-500)]' : ''}`}
                            style={{ opacity: 0, animationDelay: `${index * 0.1}s` }}
                            onClick={() => startMeditation(meditation)}
                        >
                            <div className="flex gap-4">
                                {/* Thumbnail */}
                                <div className={`w-20 h-20 rounded-xl bg-gradient-to-br ${meditation.imageGradient} flex items-center justify-center flex-shrink-0`}>
                                    {currentMeditationFile === meditation.audioFile && meditationIsPlaying ? (
                                        <AudioVisualizer isPlaying={true} bars={3} />
                                    ) : (
                                        <svg className="w-8 h-8 text-white/80" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
                                        </svg>
                                    )}
                                </div>

                                {/* Info */}
                                <div className="flex-1 relative z-10">
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <h3 className="font-semibold text-lg">{meditation.title}</h3>
                                            <p className="text-sm text-[var(--text-muted)] mt-1">
                                                {meditation.description}
                                            </p>
                                        </div>
                                        <span className="text-xs text-[var(--text-muted)] bg-white/5 px-2 py-1 rounded-full">
                                            {meditation.duration}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 mt-3">
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--primary-700)]/30 text-[var(--primary-300)]">
                                            {meditation.category}
                                        </span>
                                        <span className="text-xs text-[var(--text-muted)]">+ Beacon en vivo</span>
                                    </div>
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            </section>

            <BottomNav />
        </main>
    );
}
