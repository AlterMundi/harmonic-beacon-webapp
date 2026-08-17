const CANONICAL_PREFIX = 'BEACON_LISTENER_';
const LEGACY_PREFIX = 'EARLY_BIRDS_';

type Environment = Record<string, string | undefined>;

const BOUNDED_SUFFIXES = [
    'ENABLED',
    'FREE_FOR_ALL',
    'AUTH_BASE_URL',
    'TRUSTED_ORIGINS',
    'AUTH_SECRET',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'APPLE_ENABLED',
    'APPLE_CLIENT_ID',
    'APPLE_CLIENT_SECRET',
    'MAGIC_LINK_DELIVERY_URL',
    'MAGIC_LINK_DELIVERY_TOKEN',
    'MAGIC_LINK_RATE_SECRET',
    'TEST_ACCESS_ENABLED',
    'TEST_LOGIN_SECRET',
    'STAGING_TEAM_ENTRY_ENABLED',
    'STAGING_TEAM_ENTRY_HOSTS',
] as const;

function normalized(value: string | undefined): string | undefined {
    const result = value?.trim();
    return result ? result : undefined;
}

function names(suffix: string): { canonical: string; legacy: string } {
    return {
        canonical: `${CANONICAL_PREFIX}${suffix}`,
        legacy: `${LEGACY_PREFIX}${suffix}`,
    };
}

/**
 * Configuration errors intentionally include variable names only. Runtime
 * values may be credentials and must never be copied into logs or responses.
 */
export class ListenerRuntimeEnvironmentError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ListenerRuntimeEnvironmentError';
    }
}

/**
 * Prefer the stable Listener namespace while accepting the previous name for
 * rollback compatibility. Two populated generations must agree exactly after
 * trimming; disagreement fails closed instead of choosing an arbitrary value.
 */
export function listenerRuntimeValue(
    suffix: string,
    environment: Environment = process.env,
): string | undefined {
    const variable = names(suffix);
    const canonical = normalized(environment[variable.canonical]);
    const legacy = normalized(environment[variable.legacy]);
    if (canonical && legacy && canonical !== legacy) {
        throw new ListenerRuntimeEnvironmentError(
            `Conflicting Listener runtime variables: ${variable.canonical}, ${variable.legacy}`,
        );
    }
    return canonical ?? legacy;
}

/** Feature gates remain deliberately stricter than ordinary string config. */
export function listenerRuntimeFlag(
    suffix: string,
    environment: Environment = process.env,
): boolean {
    // Resolve first so conflicting generations still fail closed.
    listenerRuntimeValue(suffix, environment);
    const variable = names(suffix);
    const canonical = environment[variable.canonical];
    const legacy = environment[variable.legacy];
    const selected = normalized(canonical) ? canonical : legacy;
    return selected === '1';
}

/**
 * Resolve credentials that must come from one complete configuration
 * generation. This prevents, for example, pairing a new OAuth client id with
 * an old secret during a gradual cutover.
 */
export function listenerRuntimeBundle<const Suffix extends string>(
    suffixes: readonly Suffix[],
    environment: Environment = process.env,
): Record<Suffix, string> | null {
    const canonical = suffixes.map((suffix) => {
        const variable = names(suffix);
        return { suffix, name: variable.canonical, value: normalized(environment[variable.canonical]) };
    });
    const legacy = suffixes.map((suffix) => {
        const variable = names(suffix);
        return { suffix, name: variable.legacy, value: normalized(environment[variable.legacy]) };
    });
    const canonicalPresent = canonical.filter((entry) => entry.value !== undefined);
    const legacyPresent = legacy.filter((entry) => entry.value !== undefined);

    if (canonicalPresent.length > 0 && canonicalPresent.length !== canonical.length) {
        throw new ListenerRuntimeEnvironmentError(
            `Incomplete Listener runtime bundle: ${canonical.map((entry) => entry.name).join(', ')}`,
        );
    }
    if (canonicalPresent.length === 0 && legacyPresent.length > 0 && legacyPresent.length !== legacy.length) {
        throw new ListenerRuntimeEnvironmentError(
            `Incomplete Listener runtime bundle: ${legacy.map((entry) => entry.name).join(', ')}`,
        );
    }
    if (canonicalPresent.length === 0 && legacyPresent.length === 0) return null;

    if (canonicalPresent.length === canonical.length) {
        canonical.forEach((entry, index) => {
            const previous = legacy[index];
            if (previous.value && previous.value !== entry.value) {
                throw new ListenerRuntimeEnvironmentError(
                    `Conflicting Listener runtime variables: ${entry.name}, ${previous.name}`,
                );
            }
        });
        return Object.fromEntries(canonical.map((entry) => [entry.suffix, entry.value])) as Record<Suffix, string>;
    }

    return Object.fromEntries(legacy.map((entry) => [entry.suffix, entry.value])) as Record<Suffix, string>;
}

export function listenerRuntimeTrustedOrigins(
    environment: Environment = process.env,
): string[] {
    const configured = (listenerRuntimeValue('TRUSTED_ORIGINS', environment) ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
    const baseURL = listenerRuntimeValue('AUTH_BASE_URL', environment);
    return baseURL ? [...new Set([baseURL, ...configured])] : configured;
}

function selectedRawValue(suffix: string, environment: Environment): string | undefined {
    const variable = names(suffix);
    return normalized(environment[variable.canonical])
        ? environment[variable.canonical]
        : environment[variable.legacy];
}

function validateFlag(suffix: string, environment: Environment): boolean {
    const value = listenerRuntimeValue(suffix, environment);
    if (value === undefined) return false;
    const selected = selectedRawValue(suffix, environment);
    if (selected !== '0' && selected !== '1') {
        const variable = names(suffix);
        throw new ListenerRuntimeEnvironmentError(
            `Invalid Listener runtime flag: ${variable.canonical}, ${variable.legacy}`,
        );
    }
    return selected === '1';
}

const APPLE_CLIENT_SECRET_MAX_LIFETIME_SECONDS = 15_778_800;

function decodeJwtObject(segment: string): Record<string, unknown> | null {
    try {
        const decoded = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as unknown;
        return typeof decoded === 'object' && decoded !== null
            ? decoded as Record<string, unknown>
            : null;
    } catch {
        return null;
    }
}

/**
 * Validate the non-secret claims Apple documents for a Sign in with Apple
 * client-secret JWT. Apple remains the cryptographic verifier; this readiness
 * check catches expired, wrongly-scoped and accidentally pasted credentials
 * before the provider is exposed.
 */
export function validateListenerAppleClientSecret(
    clientId: string,
    clientSecret: string,
    nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
    if (clientSecret.length > 8192) return false;
    const segments = clientSecret.split('.');
    if (segments.length !== 3 || segments.some((segment) => !segment)) return false;
    const header = decodeJwtObject(segments[0]);
    const claims = decodeJwtObject(segments[1]);
    if (!header || !claims) return false;

    const issuedAt = claims.iat;
    const expiresAt = claims.exp;
    return header.alg === 'ES256' &&
        typeof header.kid === 'string' && header.kid.length > 0 && header.kid.length <= 128 &&
        typeof claims.iss === 'string' && claims.iss.length > 0 && claims.iss.length <= 128 &&
        claims.sub === clientId &&
        claims.aud === 'https://appleid.apple.com' &&
        typeof issuedAt === 'number' && Number.isInteger(issuedAt) &&
        typeof expiresAt === 'number' && Number.isInteger(expiresAt) &&
        issuedAt <= nowSeconds + 300 &&
        expiresAt > nowSeconds + 300 &&
        expiresAt > issuedAt &&
        expiresAt - issuedAt <= APPLE_CLIENT_SECRET_MAX_LIFETIME_SECONDS;
}

export function listenerAppleOAuthConfiguration(
    environment: Environment = process.env,
    nowSeconds = Math.floor(Date.now() / 1000),
): { clientId: string; clientSecret: string } | null {
    if (!validateFlag('APPLE_ENABLED', environment)) return null;
    const configuration = listenerRuntimeBundle(
        ['APPLE_ENABLED', 'APPLE_CLIENT_ID', 'APPLE_CLIENT_SECRET'],
        environment,
    );
    if (!configuration || !validateListenerAppleClientSecret(
        configuration.APPLE_CLIENT_ID,
        configuration.APPLE_CLIENT_SECRET,
        nowSeconds,
    )) {
        throw new ListenerRuntimeEnvironmentError(
            'Invalid Listener Apple OAuth configuration: BEACON_LISTENER_APPLE_CLIENT_ID, BEACON_LISTENER_APPLE_CLIENT_SECRET or matching legacy aliases',
        );
    }
    return {
        clientId: configuration.APPLE_CLIENT_ID,
        clientSecret: configuration.APPLE_CLIENT_SECRET,
    };
}

function anyBoundedValue(environment: Environment): boolean {
    return BOUNDED_SUFFIXES.some((suffix) => {
        const variable = names(suffix);
        return normalized(environment[variable.canonical]) !== undefined ||
            normalized(environment[variable.legacy]) !== undefined;
    });
}

/**
 * Readiness-time validation for the bounded compatibility slice. It is inert
 * in event/runtime processes that do not carry Listener configuration.
 */
export function validateListenerRuntimeEnvironment(
    environment: Environment = process.env,
): boolean {
    if (!anyBoundedValue(environment)) return false;

    const enabled = validateFlag('ENABLED', environment);
    validateFlag('FREE_FOR_ALL', environment);
    const baseURL = listenerRuntimeValue('AUTH_BASE_URL', environment);
    listenerRuntimeTrustedOrigins(environment);
    const authSecret = listenerRuntimeValue('AUTH_SECRET', environment);

    listenerRuntimeBundle(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], environment);
    listenerRuntimeBundle(['APPLE_CLIENT_ID', 'APPLE_CLIENT_SECRET'], environment);
    const appleEnabled = validateFlag('APPLE_ENABLED', environment);
    if (appleEnabled) {
        const apple = listenerAppleOAuthConfiguration(environment);
        let secureAuthBase = false;
        try {
            secureAuthBase = baseURL !== undefined && new URL(baseURL).protocol === 'https:';
        } catch { /* Report only the bounded variable names below. */ }
        if (!secureAuthBase) {
            throw new ListenerRuntimeEnvironmentError(
                'Enabled Listener Apple OAuth requires an HTTPS BEACON_LISTENER_AUTH_BASE_URL or matching legacy alias',
            );
        }
        if (!apple) {
            throw new ListenerRuntimeEnvironmentError('Enabled Listener Apple OAuth is unavailable');
        }
    }
    listenerRuntimeBundle([
        'MAGIC_LINK_DELIVERY_URL',
        'MAGIC_LINK_DELIVERY_TOKEN',
        'MAGIC_LINK_RATE_SECRET',
    ], environment);

    const testAccess = validateFlag('TEST_ACCESS_ENABLED', environment);
    if (testAccess) {
        listenerRuntimeBundle(['TEST_ACCESS_ENABLED', 'TEST_LOGIN_SECRET'], environment);
    }
    const stagingEntry = validateFlag('STAGING_TEAM_ENTRY_ENABLED', environment);
    if (stagingEntry) {
        listenerRuntimeBundle([
            'STAGING_TEAM_ENTRY_ENABLED',
            'STAGING_TEAM_ENTRY_HOSTS',
        ], environment);
    }

    if (enabled && (!baseURL || !authSecret)) {
        throw new ListenerRuntimeEnvironmentError(
            'Enabled Listener requires BEACON_LISTENER_AUTH_BASE_URL and BEACON_LISTENER_AUTH_SECRET or matching legacy aliases',
        );
    }
    return true;
}
