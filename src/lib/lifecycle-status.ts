export type LifecycleStatus = 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED';

export function advanceLifecycleStatus(
    current: LifecycleStatus,
    observed: LifecycleStatus,
): LifecycleStatus {
    if (current === 'SCHEDULED') return observed;
    if (current === 'LIVE' && (observed === 'ENDED' || observed === 'CANCELLED')) {
        return observed;
    }
    return current;
}
