export const AUTHORITY_ENV: string;
export const TARGET_DIRECTORY: string;
export const TARGET_ENV: string;
export const ISSUER: string;
export const CLIENT_ID: string;
export const AUTHORITY_KEY: string;
export const TARGET_KEYS: string[];

export function parseEnv(contents: string): Map<string, string>;
export function validateTarget(values: Map<string, string>): Map<string, string>;
export function buildTarget(
    authority: Map<string, string>,
): string;
