/**
 * Secret redaction for anything on its way to a log.
 *
 * Two classes of secret in this app are routinely embedded in strings that we
 * *want* to log for diagnostics:
 *
 *   - Database URLs. A `pg` auth failure puts the whole connection string,
 *     password included, into `error.message`.
 *   - Presigned S3/R2 URLs. The signature is a bearer token in the query
 *     string — anyone holding the logged line can read or write the object
 *     until it expires.
 *
 * In the single-host deploy those landed in a local file. In the cloud target
 * stdout is shipped to a third-party log aggregator, so redaction has to
 * happen before the write, not at the sink.
 */

/** Credentials in a URL userinfo section: scheme://user:password@host */
const URL_CREDENTIALS = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:/?#\s@]+):([^@/?#\s]*)@/g;

/**
 * Sensitive query parameters. Covers AWS SigV4 (`X-Amz-*`, used by R2 presigned
 * URLs) plus the usual token/secret parameter names.
 */
const SENSITIVE_QUERY_PARAMS = new RegExp(
    '([?&])(' +
        [
            'X-Amz-Signature',
            'X-Amz-Credential',
            'X-Amz-Security-Token',
            'signature',
            'token',
            'access_token',
            'id_token',
            'refresh_token',
            'apikey',
            'api_key',
            'secret',
            'password',
        ].join('|') +
        ')=([^&\\s]*)',
    'gi',
);

export const REDACTED = '[REDACTED]';

/**
 * Strip secrets from a string bound for a log.
 *
 * Preserves everything diagnostically useful — scheme, host, port, path,
 * username, and the non-sensitive query parameters — so a redacted line is
 * still worth reading.
 */
export function redactSecrets(input: string): string {
    return input
        .replace(URL_CREDENTIALS, (_match, scheme, user) => `${scheme}${user}:${REDACTED}@`)
        .replace(SENSITIVE_QUERY_PARAMS, (_match, sep, key) => `${sep}${key}=${REDACTED}`);
}

/**
 * Render an unknown thrown value as a redacted, log-safe one-liner.
 *
 * Omits the stack trace — not for safety (see `redactErrorDetail`) but for
 * volume. Use this on paths that run on a timer, such as the readiness probe a
 * load balancer hits every 30 seconds: during an outage every one of those
 * would otherwise emit a full stack.
 *
 * For a one-off failure you want to debug, prefer `redactErrorDetail`.
 */
export function redactError(error: unknown): string {
    if (error instanceof Error) {
        return `${error.name}: ${redactSecrets(error.message)}`;
    }
    return redactUnknown(error);
}

/**
 * Same as `redactError`, but keeps the stack trace — redacted.
 *
 * A V8 stack is function names and source locations; it does not include
 * argument values, so running the redactor over the whole string covers it as
 * completely as it covers the message. Preferred for one-off error paths, where
 * losing the stack costs real debuggability and gains nothing.
 */
export function redactErrorDetail(error: unknown): string {
    if (error instanceof Error) {
        // error.stack already begins with "Name: message".
        return error.stack
            ? redactSecrets(error.stack)
            : `${error.name}: ${redactSecrets(error.message)}`;
    }
    return redactUnknown(error);
}

function redactUnknown(value: unknown): string {
    if (typeof value === 'string') {
        return redactSecrets(value);
    }
    try {
        return redactSecrets(JSON.stringify(value) ?? String(value));
    } catch {
        return '[unserializable error]';
    }
}
