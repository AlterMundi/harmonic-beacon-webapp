const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const FIXTURE_DATABASE_NAME = 'beacon_test';

/**
 * E2E tests are allowed to mutate only the dedicated local fixture database.
 * Keep this check deliberately strict: an opt-in environment variable is not
 * sufficient protection against accidentally pasting a production URL.
 */
export function isSafeFixtureDatabaseUrl(value: string | undefined): value is string {
    if (!value) return false;

    try {
        const url = new URL(value);
        const databaseName = decodeURIComponent(url.pathname).replace(/^\//, '');
        return (
            (url.protocol === 'postgres:' || url.protocol === 'postgresql:') &&
            LOCAL_DATABASE_HOSTS.has(url.hostname) &&
            databaseName === FIXTURE_DATABASE_NAME
        );
    } catch {
        return false;
    }
}

export function assertSafeFixtureDatabaseUrl(value: string | undefined): asserts value is string {
    if (!isSafeFixtureDatabaseUrl(value)) {
        throw new Error(
            'E2E_DATABASE_URL must point to the local beacon_test PostgreSQL database; refusing to run a state-changing browser gate.',
        );
    }
}
