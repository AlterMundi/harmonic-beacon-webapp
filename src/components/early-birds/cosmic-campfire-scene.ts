import type { ListenerCampfireFixture } from '@/lib/early-birds/campfire-prototype';

export type CampfireBand = 'near' | 'middle' | 'far';

type NormalizedListener = {
    id: string;
    x: number;
    y: number;
    band: CampfireBand;
};

export type CampfireFrame = {
    fire: {
        x: number;
        y: number;
        radius: number;
        breath: number;
    };
    self: {
        x: number;
        y: number;
        radius: number;
    };
    listeners: Array<NormalizedListener & { radius: number }>;
    embers: Array<{
        x: number;
        y: number;
        radius: number;
        alpha: number;
    }>;
};

const NEAR: NormalizedListener[] = [
    { id: 'near-west', x: 0.42, y: 0.64, band: 'near' },
    { id: 'near-east', x: 0.58, y: 0.63, band: 'near' },
];

const MIDDLE: NormalizedListener[] = [
    { id: 'middle-west', x: 0.29, y: 0.70, band: 'middle' },
    { id: 'middle-east', x: 0.72, y: 0.69, band: 'middle' },
    { id: 'middle-north', x: 0.52, y: 0.37, band: 'middle' },
];

const FAR: NormalizedListener[] = [
    { id: 'far-west', x: 0.12, y: 0.54, band: 'far' },
    { id: 'far-east', x: 0.88, y: 0.49, band: 'far' },
    { id: 'far-north-west', x: 0.25, y: 0.24, band: 'far' },
    { id: 'far-north-east', x: 0.78, y: 0.23, band: 'far' },
];

export const CAMPFIRE_FIXTURE_LISTENERS: Record<ListenerCampfireFixture, NormalizedListener[]> = {
    empty: [],
    near: NEAR,
    middle: [...NEAR, ...MIDDLE],
    far: [...NEAR, ...MIDDLE, ...FAR],
};

const EMBERS = [
    { x: -0.018, y: -0.056, radius: 0.006, phase: 0.3 },
    { x: 0.022, y: -0.083, radius: 0.004, phase: 1.4 },
    { x: -0.036, y: -0.112, radius: 0.003, phase: 2.5 },
    { x: 0.009, y: -0.145, radius: 0.0035, phase: 3.2 },
] as const;

export function buildCampfireFrame(
    fixture: ListenerCampfireFixture,
    elapsedMs: number,
    motion: boolean,
): CampfireFrame {
    const time = motion ? elapsedMs / 1_000 : 0;
    const breath = 1 + Math.sin(time * 0.72) * 0.045;

    return {
        fire: { x: 0.5, y: 0.55, radius: 0.074, breath },
        self: { x: 0.5, y: 0.87, radius: 0.0075 },
        listeners: CAMPFIRE_FIXTURE_LISTENERS[fixture].map((listener) => ({
            ...listener,
            radius: listener.band === 'near' ? 0.007
                : listener.band === 'middle' ? 0.0055 : 0.0045,
        })),
        embers: EMBERS.map((ember) => ({
            x: 0.5 + ember.x + (motion ? Math.sin(time * 0.8 + ember.phase) * 0.006 : 0),
            y: 0.55 + ember.y - (motion ? ((time * 0.018 + ember.phase * 0.004) % 0.07) : 0),
            radius: ember.radius,
            alpha: motion ? 0.42 + Math.sin(time * 1.1 + ember.phase) * 0.16 : 0.48,
        })),
    };
}
