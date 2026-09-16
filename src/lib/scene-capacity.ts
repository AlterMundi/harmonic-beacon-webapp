export const SCENE_CAPACITIES = [6, 9, 12] as const;
export type SceneCapacity = (typeof SCENE_CAPACITIES)[number];
export const DEFAULT_SCENE_CAPACITY: SceneCapacity = 6;

export function isSceneCapacity(value: unknown): value is SceneCapacity {
    return typeof value === 'number' && SCENE_CAPACITIES.includes(value as SceneCapacity);
}

export function parseSceneCapacity(value: unknown): SceneCapacity {
    if (!isSceneCapacity(value)) {
        throw new Error('Scene capacity must be 6, 9, or 12');
    }
    return value;
}
