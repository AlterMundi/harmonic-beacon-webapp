import { isAbsolute } from 'node:path';

type DropInLanguage = 'es' | 'en';

export function configuredEarlyBirdDropIn(
    language: DropInLanguage,
    environment: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
    const suffix = language.toUpperCase();
    const configuredPath = environment[`EARLY_BIRDS_DROPIN_${suffix}_PATH`]?.trim();
    return configuredPath && isAbsolute(configuredPath)
        ? `/api/early-birds/drop-ins/${language}`
        : null;
}
