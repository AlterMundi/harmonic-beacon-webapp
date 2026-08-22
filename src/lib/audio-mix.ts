export const BEACON_SESSION_FLOOR_RATIO = 0.25;

function clampUnit(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
}

/**
 * Personal room mix. Balance 0 is fully Beacon; balance 1 is fully Session.
 * The Session end deliberately retains a quiet Beacon bed, while the Beacon
 * end is exclusive and removes the stage voice completely.
 */
export function roomMixGains(masterVolume: number, balance: number): {
    beacon: number;
    session: number;
} {
    const master = clampUnit(masterVolume);
    const normalizedBalance = clampUnit(balance);
    return {
        beacon: master * (
            1 - normalizedBalance * (1 - BEACON_SESSION_FLOOR_RATIO)
        ),
        session: master * normalizedBalance,
    };
}
