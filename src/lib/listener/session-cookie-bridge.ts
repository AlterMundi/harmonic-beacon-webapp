/**
 * Canonical Listener session-cookie bridge.
 *
 * Better Auth remains the sole session authority: it alone mints, signs,
 * verifies, rotates and revokes session tokens on the legacy EarlyBird base
 * path. The signed cookie value Better Auth emits is opaque and its HMAC does
 * not cover the cookie name, so the value is portable verbatim under a second
 * name. This module only:
 *
 * - mirrors every legacy session `Set-Cookie` Better Auth emits onto the
 *   canonical Listener name with byte-identical value and attributes, and
 * - enforces which inbound session-cookie states may reach Better Auth at
 *   all during the rollback-compatible phase.
 *
 * Inbound, exactly three states are accepted: no session cookie, exactly one
 * legacy-only session cookie, or exactly one canonical plus one byte-identical
 * legacy cookie. Everything else — canonical-only, duplicate same-name
 * cookies, conflicting pairs, malformed percent encoding or control
 * characters, oversized values or an oversized header — terminates with a
 * generic 400/401 BEFORE Better Auth is invoked, so no ambiguous request can
 * be silently repaired by better-call's first-wins parser or mint a fresh
 * session on sign-in/OAuth callback paths.
 *
 * Every such rejection also expires BOTH exact session cookie names with
 * `Max-Age=0` and the resolved secure scope. That is what keeps a
 * deploy/rollback/redeploy sequence recoverable: a rollback image's sign-out
 * clears only the legacy name, so a stale canonical cookie would otherwise
 * 401 forever (or a stale canonical plus a fresh legacy would 400) and no
 * accepted auth mutation could ever repair it, because every ambiguous state
 * stops before Better Auth. Clearing both names logs the client out but lets
 * the next clean sign-in mint a fresh dual pair. The rejected values are
 * never echoed, parsed or logged — the expiry cookies carry empty values.
 *
 * Outbound, mirroring happens only for unambiguous output: exactly one legacy
 * session mutation and either no canonical mutation or one byte-identical
 * canonical mutation with identical security attributes. Any other shape
 * (repeated same-name mutations, mismatched pairs, canonical mutations
 * without a legacy counterpart) is an internal failure: the response is
 * replaced by a generic 500 carrying no Set-Cookie at all.
 *
 * The value is lexically bounded and validated, but its token contents are
 * never decoded, interpreted, re-signed or logged here. OAuth state, PKCE and
 * any other non-session cookies pass through untouched in both directions.
 */

import {
    recordListenerSessionCookieObservation,
    type ListenerSessionCookieState,
} from '@/lib/listener/session-cookie-observability';
import { isCanonicalListenerHost } from '@/lib/listener/public-discovery';

export const LISTENER_SESSION_COOKIE = 'hb_listener_session';

const SECURE_COOKIE_PREFIX = '__Secure-';

/** Bound cookie-header smuggling without rejecting legitimate other cookies. */
const MAX_COOKIE_HEADER_LENGTH = 8192;
/**
 * A Better Auth signed session value is `encodeURIComponent(token + "." +
 * base64 HMAC)` and stays well under 200 characters; 512 leaves headroom for
 * token-format changes without accepting junk.
 */
const MAX_SESSION_COOKIE_VALUE_LENGTH = 512;
/** Characters `encodeURIComponent` can leave on the wire; excludes controls. */
const WIRE_VALUE_CHARSET = /^[A-Za-z0-9\-_.!~*'()%]+$/;
const INVALID_PERCENT_ESCAPE = /%(?![0-9A-Fa-f]{2})/;

/**
 * The cookie scope the bridge must match when it expires session cookies
 * itself (rejections). Derived from the session cookie attributes Better
 * Auth actually resolved (`getCookies(auth.options).sessionToken.attributes`)
 * so an expiry lands on exactly the scope Better Auth minted into. A Domain
 * is never invented: only an attribute Better Auth itself resolved is copied.
 */
export type ListenerSessionCookieScope = {
    readonly path: string;
    readonly httpOnly: boolean;
    readonly sameSite: string;
    readonly secure: boolean;
};

export type ListenerSessionCookieNames = {
    /** Resolved session cookie name Better Auth reads and writes. */
    readonly legacy: string;
    /** Canonical Listener name carrying the same opaque value. */
    readonly canonical: string;
    /** Resolved scope shared by both names; used for bridge-side expiries. */
    readonly scope: ListenerSessionCookieScope;
};

/**
 * Derives the bridge pair from the session cookie name Better Auth actually
 * resolved (via `getCookies(auth.options)`), inheriting its `__Secure-`
 * convention so both names always share one security posture. `scope` should
 * come from the resolved Better Auth session-cookie attributes; without it
 * the secure posture follows the name and Better Auth's documented defaults.
 */
export function listenerSessionCookieNames(
    resolvedLegacyName: string,
    scope?: Partial<ListenerSessionCookieScope>,
): ListenerSessionCookieNames {
    const secure = resolvedLegacyName.startsWith(SECURE_COOKIE_PREFIX);
    return {
        legacy: resolvedLegacyName,
        canonical: `${secure ? SECURE_COOKIE_PREFIX : ''}${LISTENER_SESSION_COOKIE}`,
        scope: {
            path: scope?.path ?? '/',
            httpOnly: scope?.httpOnly ?? true,
            sameSite: scope?.sameSite ?? 'Lax',
            secure: scope?.secure ?? secure,
        },
    };
}

/**
 * Builds the dual session-cookie expiry for a bridge-side rejection: both
 * exact names with empty values, `Max-Age=0` and the resolved scope, so the
 * client is logged out on whichever names it holds and the next clean
 * sign-in can mint a fresh dual pair. Never carries a session value and
 * never adds a Domain attribute.
 */
export function listenerSessionClearCookies(
    names: ListenerSessionCookieNames,
): string[] {
    const { path, httpOnly, sameSite, secure } = names.scope;
    const attributes = [
        'Max-Age=0',
        `Path=${path}`,
        ...(httpOnly ? ['HttpOnly'] : []),
        `SameSite=${sameSite}`,
        ...(secure ? ['Secure'] : []),
    ].join('; ');
    return [names.legacy, names.canonical].map((name) => `${name}=; ${attributes}`);
}

/**
 * Strict inbound verdict. `forward` carries the Cookie header to present to
 * Better Auth (null when the request had none). `reject` terminates the
 * request before Better Auth with a generic status: 401 for a well-formed
 * canonical-only credential that is not accepted during this phase, 400 for
 * every structurally invalid state.
 */
export type ListenerSessionCookieResolution =
    | { readonly kind: 'forward'; readonly header: string | null }
    | { readonly kind: 'reject'; readonly status: 400 | 401 };

type CookiePart = {
    readonly name: string;
    readonly value: string;
};

function parseCookieParts(header: string): CookiePart[] {
    return header.split(';').map((raw) => {
        const separator = raw.indexOf('=');
        if (separator < 1) return { name: '', value: '' };
        return {
            name: raw.slice(0, separator).trim(),
            value: raw.slice(separator + 1).trim(),
        };
    });
}

function wellFormedSessionValue(value: string): boolean {
    return value.length > 0 &&
        value.length <= MAX_SESSION_COOKIE_VALUE_LENGTH &&
        WIRE_VALUE_CHARSET.test(value) &&
        !INVALID_PERCENT_ESCAPE.test(value);
}

/**
 * Pure inbound inspection: the aggregate compatibility `state` observed for
 * observability plus the strict `resolution` the bridge enforces. The state
 * classification is closed and ordered by precedence:
 *
 * 1. no relevant session cookie (or no header at all) -> `none`;
 * 2. oversized whole Cookie header -> `oversized_header`;
 * 3. a duplicate of either relevant name -> `duplicate_name`;
 * 4. a relevant value over 512 characters -> `oversized_value`;
 * 5. an empty, non-wire-charset or bad-percent relevant value -> `malformed_value`;
 * 6. a well-formed canonical cookie without its legacy counterpart -> `canonical_only`;
 * 7. a canonical/legacy pair whose values differ -> `conflicting_pair`;
 * 8. exactly one legacy cookie -> `legacy_only`;
 * 9. a byte-identical canonical/legacy pair -> `dual_identical`.
 *
 * `resolveListenerSessionCookie` is exactly this inspection's `resolution`.
 */
export type ListenerSessionCookieInspection = {
    readonly state: ListenerSessionCookieState;
    readonly resolution: ListenerSessionCookieResolution;
};

/**
 * Resolves whether an inbound Cookie header may reach Better Auth under the
 * bridge policy, and classifies the aggregate compatibility state observed.
 * Accepted states are forwarded byte-for-byte (Better Auth ignores the
 * canonical name and reads the legacy one); no state is ever rewritten or
 * stripped, because repairing an ambiguous header is exactly what
 * better-call's first-wins parser would do silently.
 */
export function inspectListenerSessionCookie(
    header: string | null,
    names: ListenerSessionCookieNames,
): ListenerSessionCookieInspection {
    const forward: ListenerSessionCookieResolution = { kind: 'forward', header };
    if (!header) return { state: 'none', resolution: forward };

    const parts = parseCookieParts(header);
    const legacyParts = parts.filter((part) => part.name === names.legacy);
    const canonicalParts = parts.filter((part) => part.name === names.canonical);
    if (legacyParts.length === 0 && canonicalParts.length === 0) {
        return { state: 'none', resolution: forward };
    }

    const reject = (status: 400 | 401): ListenerSessionCookieResolution =>
        ({ kind: 'reject', status });

    if (header.length > MAX_COOKIE_HEADER_LENGTH) {
        return { state: 'oversized_header', resolution: reject(400) };
    }
    if (legacyParts.length > 1 || canonicalParts.length > 1) {
        return { state: 'duplicate_name', resolution: reject(400) };
    }
    const relevant = [...legacyParts, ...canonicalParts];
    if (relevant.some((part) => part.value.length > MAX_SESSION_COOKIE_VALUE_LENGTH)) {
        return { state: 'oversized_value', resolution: reject(400) };
    }
    if (relevant.some((part) => !wellFormedSessionValue(part.value))) {
        return { state: 'malformed_value', resolution: reject(400) };
    }

    const legacy = legacyParts[0];
    const canonical = canonicalParts[0];
    // A well-formed canonical credential without its legacy counterpart is
    // not accepted during the rollback-compatible phase.
    if (!legacy) return { state: 'canonical_only', resolution: reject(401) };
    // Conflicting values are never arbitrated between.
    if (canonical && canonical.value !== legacy.value) {
        return { state: 'conflicting_pair', resolution: reject(400) };
    }
    return { state: canonical ? 'dual_identical' : 'legacy_only', resolution: forward };
}

/**
 * Resolves whether an inbound Cookie header may reach Better Auth under the
 * bridge policy. Pure delegation to `inspectListenerSessionCookie`; the
 * resolution behavior is byte-identical to the pre-observability bridge.
 */
export function resolveListenerSessionCookie(
    header: string | null,
    names: ListenerSessionCookieNames,
): ListenerSessionCookieResolution {
    return inspectListenerSessionCookie(header, names).resolution;
}

/**
 * Mirrors the legacy session `Set-Cookie` onto the canonical name with the
 * value and all attributes byte-identical, under the strict output policy:
 *
 * - exactly one legacy mutation and no canonical mutation: one canonical
 *   mirror is appended (this covers mint, rotation and clear alike);
 * - exactly one legacy and one canonical mutation that are byte-identical
 *   apart from the name: the output is already dual, nothing is appended;
 * - no session mutation at all: nothing is appended.
 *
 * Returns null for every ambiguous shape — repeated same-name mutations, a
 * canonical mutation without a legacy counterpart, or a pair whose value or
 * security attributes differ. Callers must treat null as an internal failure
 * and emit no session cookie at all. Cookies with any other name (OAuth
 * state, PKCE, CSRF, unrelated) are never inspected beyond the name match.
 */
export function listenerSessionSetCookieMirrors(
    setCookies: readonly string[],
    names: ListenerSessionCookieNames,
): string[] | null {
    const nameOf = (entry: string): string => {
        const separator = entry.indexOf('=');
        return separator < 1 ? '' : entry.slice(0, separator);
    };
    const legacyMutations = setCookies.filter((entry) => nameOf(entry) === names.legacy);
    const canonicalMutations = setCookies.filter((entry) => nameOf(entry) === names.canonical);

    if (legacyMutations.length > 1 || canonicalMutations.length > 1) return null;
    const legacy = legacyMutations[0];
    const canonical = canonicalMutations[0];
    if (!legacy) return canonical ? null : [];
    if (!canonical) return [`${names.canonical}${legacy.slice(names.legacy.length)}`];
    const identical = canonical.slice(names.canonical.length) ===
        legacy.slice(names.legacy.length);
    return identical ? [] : null;
}

/**
 * Generic rejection: no token or cookie detail, but both exact session
 * cookie names are expired so a stale canonical or legacy cookie left by a
 * deploy/rollback/redeploy sequence cannot lock the client out of recovery.
 */
function rejectionResponse(
    status: 400 | 401,
    names: ListenerSessionCookieNames,
): Response {
    const headers = new Headers({
        'content-type': 'application/json',
        'cache-control': 'private, no-store',
    });
    for (const clear of listenerSessionClearCookies(names)) {
        headers.append('set-cookie', clear);
    }
    return new Response(JSON.stringify({ error: 'invalid session credentials' }), {
        status,
        headers,
    });
}

/** Generic internal failure: ambiguous output must not reach the client. */
function ambiguousOutputResponse(): Response {
    return new Response(JSON.stringify({ error: 'internal error' }), {
        status: 500,
        headers: {
            'content-type': 'application/json',
            'cache-control': 'private, no-store',
        },
    });
}

/**
 * Applies the outbound bridge policy: appends the canonical mirror of a
 * single legacy session `Set-Cookie`, or replaces the whole response with a
 * generic 500 when Better Auth's session-cookie output is ambiguous.
 */
export function mirrorListenerSessionResponse(
    response: Response,
    names: ListenerSessionCookieNames,
): Response {
    const mirrors = listenerSessionSetCookieMirrors(response.headers.getSetCookie(), names);
    if (mirrors === null) return ambiguousOutputResponse();
    if (mirrors.length === 0) return response;
    const headers = new Headers(response.headers);
    for (const mirror of mirrors) headers.append('set-cookie', mirror);
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

/**
 * Wraps a Better Auth handler so every request/response pair crosses the
 * bridge. Invalid inbound session-cookie states terminate with a generic
 * 400/401 (expiring both session cookie names) before the handler runs, so no
 * ambiguous request can mint, rotate or clear a session; ambiguous outbound
 * output fails closed with a generic 500 carrying no Set-Cookie at all. The
 * wrapped handler stays the only code that touches sessions.
 *
 * Each invocation also records the inspected aggregate compatibility state
 * for observability. Recording is fail-soft: an observer failure can never
 * change the resolution, the handler invocation, or the response.
 */
export function listenerSessionAuthHandler(
    handler: (request: Request) => Promise<Response>,
    names: ListenerSessionCookieNames,
): (request: Request) => Promise<Response> {
    return async (request) => {
        const inspection = inspectListenerSessionCookie(request.headers.get('cookie'), names);
        if (isCanonicalListenerHost(request.headers)) {
            try {
                recordListenerSessionCookieObservation(inspection.state);
            } catch { /* Observation must never affect authentication. */ }
        }
        if (inspection.resolution.kind === 'reject') {
            return rejectionResponse(inspection.resolution.status, names);
        }
        return mirrorListenerSessionResponse(await handler(request), names);
    };
}
