export type ReactiveRenderPolicy = {
    conservative: boolean;
    frameIntervalMs: number;
    maxDevicePixelRatio: number;
};

export function resolveReactiveRenderPolicy({
    reducedMotion,
    saveData,
}: {
    reducedMotion: boolean;
    saveData: boolean;
}): ReactiveRenderPolicy {
    const conservative = reducedMotion || saveData;
    return {
        conservative,
        frameIntervalMs: conservative ? 500 : 1_000 / 30,
        maxDevicePixelRatio: 1.5,
    };
}
