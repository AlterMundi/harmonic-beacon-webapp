type SearchValue = string | string[] | undefined;

function first(value: SearchValue): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

/**
 * Interpret the signed OAuth login prompt emitted by the fixed Live clients.
 * This only controls which UI Account renders; Live validates auth_method again
 * before granting event access.
 */
export function requiredProviderFromSignedQuery(
    query: Record<string, SearchValue>,
): 'google' | null {
    const prompt = first(query.prompt);
    const clientId = first(query.client_id);
    const hasSignedContext = Boolean(first(query.sig) && first(query.exp));
    return hasSignedContext &&
        prompt?.split(/\s+/).includes('login') &&
        (clientId === 'hb-live' || clientId === 'hb-live-staging')
        ? 'google'
        : null;
}
