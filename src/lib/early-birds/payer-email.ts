export function normalizeMercadoPagoPayerEmail(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (normalized.length < 3 || normalized.length > 320 ||
        normalized.split('@').length !== 2 || normalized.startsWith('@') ||
        normalized.endsWith('@') || /[\s\x00-\x20\x7f]/.test(normalized)) {
        return null;
    }
    return normalized;
}
