import { randomInt } from 'node:crypto';

export const ACCOUNT_CREDENTIAL_FLOOR_MS = 500;
export const ACCOUNT_CREDENTIAL_JITTER_MAX_MS = 40;

export async function enforceAccountCredentialFloor(
    startedAt: number,
    dependencies: {
        now?: () => number;
        jitter?: () => number;
        sleep?: (milliseconds: number) => Promise<void>;
    } = {},
): Promise<void> {
    const now = dependencies.now ?? Date.now;
    const jitter = dependencies.jitter ?? (() => randomInt(0, ACCOUNT_CREDENTIAL_JITTER_MAX_MS + 1));
    const sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    const remaining = ACCOUNT_CREDENTIAL_FLOOR_MS + jitter() - (now() - startedAt);
    if (remaining > 0) await sleep(remaining);
}
