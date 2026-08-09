'use client';

import { useState } from 'react';

import styles from './ReactiveCampfire.module.css';
import {
    REACTIVE_PALETTES,
    REACTIVE_VISUALIZATION_MODES,
    type ReactiveCampfireSettings,
    serializeReactiveCampfirePreset,
    validateReactiveCampfireSettings,
} from './settings';

export type ReactiveCampfireTuningPanelProps = {
    enabled: boolean;
    settings: ReactiveCampfireSettings;
    onChange: (settings: ReactiveCampfireSettings) => void;
    analysisControlsLocked?: boolean;
};

type NumberField = Exclude<
    keyof ReactiveCampfireSettings,
    'palette' | 'visualizationMode' | 'fftSize'
>;

const NUMBER_FIELDS: Array<{
    key: NumberField;
    label: string;
    min: number;
    max: number;
    step: number;
    suffix?: string;
}> = [
    { key: 'sensitivity', label: 'Variation sensitivity', min: 0.2, max: 3, step: 0.05 },
    { key: 'absoluteFloorDb', label: 'Visible floor', min: -120, max: -36, step: 1, suffix: ' dB' },
    { key: 'baselineDurationSeconds', label: 'Slow baseline', min: 5, max: 120, step: 1, suffix: ' s' },
    { key: 'attackMs', label: 'Visual attack', min: 20, max: 1_000, step: 10, suffix: ' ms' },
    { key: 'releaseMs', label: 'Visual release', min: 80, max: 4_000, step: 20, suffix: ' ms' },
    { key: 'trailSeconds', label: 'Upper full-ribbon trails', min: 0, max: 4, step: 0.1, suffix: ' s' },
    { key: 'density', label: 'Harmonic density', min: 0.2, max: 1, step: 0.05 },
    { key: 'highDetail', label: 'High detail', min: 0, max: 1, step: 0.05 },
    { key: 'centerCutPercent', label: 'Center field', min: 0, max: 100, step: 1, suffix: '%' },
    { key: 'radialSpacingGrowthPercent', label: 'Outer spacing growth', min: 0, max: 250, step: 1, suffix: '%' },
    { key: 'zoomPercent', label: 'Zoom', min: 50, max: 220, step: 1, suffix: '%' },
    { key: 'activationTtlSeconds', label: 'Activation TTL', min: 0, max: 30, step: 0.5, suffix: ' s' },
    { key: 'ribbonWidth', label: 'Ribbon width', min: 0.6, max: 3, step: 0.05 },
];

const VISUALIZATION_LABELS: Record<ReactiveCampfireSettings['visualizationMode'], string> = {
    'analysis-only': 'Analysis only · no Canvas',
    'minimal-pulse': 'Minimal pulse · 2 fps',
    'harmonic-radial-series': 'Harmonic radial series',
    'radial-ribbons': 'Radial ribbons',
    'horizon-flow': 'Horizon flow',
};

function downloadPreset(serialized: string) {
    const url = URL.createObjectURL(new Blob([serialized], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'beacon-reactive-campfire-preset.json';
    anchor.click();
    URL.revokeObjectURL(url);
}

export function ReactiveCampfireTuningPanel({
    enabled,
    settings,
    onChange,
    analysisControlsLocked = false,
}: ReactiveCampfireTuningPanelProps) {
    const [status, setStatus] = useState('');
    if (!enabled) return null;

    const update = (patch: Partial<ReactiveCampfireSettings>) => {
        onChange(validateReactiveCampfireSettings({ ...settings, ...patch }));
    };
    const copyPreset = async () => {
        const serialized = serializeReactiveCampfirePreset(settings);
        try {
            if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
            await navigator.clipboard.writeText(serialized);
            setStatus('Preset copied');
        } catch {
            downloadPreset(serialized);
            setStatus('Clipboard unavailable; preset downloaded');
        }
    };

    return (
        <details className={styles.panel} data-testid="reactive-campfire-tuning-panel">
            <summary className={styles.summary}>Reactive field lab</summary>
            <div className={styles.form}>
                <p className={styles.guide}>
                    Test: field off = direct baseline; Analysis only = analysis without Canvas;
                    Minimal pulse = lowest visual workload; then compare a full field.
                </p>
                {NUMBER_FIELDS.map((field) => (
                    <label className={styles.field} key={field.key}>
                        <span>
                            {field.label}{' '}
                            <span className={styles.value}>
                                {settings[field.key]}{field.suffix}
                            </span>
                        </span>
                        {field.key === 'centerCutPercent' && (
                            <span className={styles.hint}>
                                {settings.visualizationMode === 'harmonic-radial-series'
                                    ? 'Fixed · complete harmonic series'
                                    : settings.centerCutPercent === 0
                                    ? 'All outer ribbons'
                                    : settings.centerCutPercent === 100
                                        ? 'All center field'
                                        : `${settings.centerCutPercent}% center · ${100 - settings.centerCutPercent}% outer`}
                            </span>
                        )}
                        <input
                            type="range"
                            min={field.min}
                            max={field.max}
                            step={field.step}
                            value={settings[field.key]}
                            disabled={(analysisControlsLocked && field.key === 'baselineDurationSeconds')
                                || (settings.visualizationMode === 'harmonic-radial-series'
                                    && field.key === 'centerCutPercent')
                                || (settings.visualizationMode !== 'harmonic-radial-series'
                                    && field.key === 'radialSpacingGrowthPercent')}
                            onChange={(event) => update({
                                [field.key]: Number(event.currentTarget.value),
                            })}
                        />
                    </label>
                ))}
                <label className={styles.field}>
                    <span>Visualization</span>
                    <select
                        aria-label="Visualization"
                        value={settings.visualizationMode}
                        onChange={(event) => update({
                            visualizationMode: event.currentTarget.value as ReactiveCampfireSettings['visualizationMode'],
                        })}
                    >
                        {REACTIVE_VISUALIZATION_MODES.map((mode) => (
                            <option value={mode} key={mode}>
                                {VISUALIZATION_LABELS[mode]}
                            </option>
                        ))}
                    </select>
                    {settings.visualizationMode === 'analysis-only' && (
                        <span className={styles.hint}>
                            Full audio analysis stays active; scene calculation and Canvas are off.
                        </span>
                    )}
                    {settings.visualizationMode === 'minimal-pulse' && (
                        <span className={styles.hint}>
                            One measured level halo at 2 fps; no harmonic scene or ribbons.
                        </span>
                    )}
                </label>
                <label className={styles.field}>
                    <span>Palette</span>
                    <select
                        aria-label="Palette"
                        value={settings.palette}
                        onChange={(event) => update({
                            palette: event.currentTarget.value as ReactiveCampfireSettings['palette'],
                        })}
                    >
                        {REACTIVE_PALETTES.map((palette) => (
                            <option value={palette} key={palette}>{palette}</option>
                        ))}
                    </select>
                </label>
                <label className={styles.field}>
                    <span>FFT size</span>
                    <select
                        aria-label="FFT size"
                        value={settings.fftSize}
                        disabled={analysisControlsLocked}
                        onChange={(event) => update({
                            fftSize: Number(event.currentTarget.value) as ReactiveCampfireSettings['fftSize'],
                        })}
                    >
                        <option value={8_192}>8192 · lighter</option>
                        <option value={16_384}>16384 · more detail</option>
                    </select>
                    {analysisControlsLocked && (
                        <span className={styles.hint}>Stop to change · 8192 / 16384 available</span>
                    )}
                </label>
                <div className={styles.actions}>
                    <button className={styles.button} type="button" onClick={copyPreset}>
                        Copy preset
                    </button>
                    <button
                        className={styles.button}
                        type="button"
                        onClick={() => {
                            downloadPreset(serializeReactiveCampfirePreset(settings));
                            setStatus('Preset downloaded');
                        }}
                    >
                        Download JSON
                    </button>
                    <span className={styles.status} role="status" aria-live="polite">{status}</span>
                </div>
            </div>
        </details>
    );
}
