/**
 * Bounded await for health probes.
 *
 * A health check that hangs is worse than one that fails: the load balancer
 * and the operator dashboard both conclude "down" from a timeout, but only if
 * the timeout actually fires. Every probe that leaves the process (database,
 * LiveKit API, tapestry) is wrapped in this.
 */

export class OperationTimeoutError extends Error {
    constructor(label: string, ms: number) {
        super(`${label} timed out after ${ms}ms`);
        this.name = 'OperationTimeoutError';
    }
}

/**
 * Race `promise` against a timer. The timer is cleared on settlement so a
 * fast success does not keep the event loop (or a dangling rejection) alive.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'Operation'): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new OperationTimeoutError(label, ms)), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}
