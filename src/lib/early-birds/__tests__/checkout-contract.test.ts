import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CONTRACT_DIRS = [
    'contracts/early-bird-authority/v1',
    'contracts/early-bird-authority/v2',
    'contracts/early-bird-checkout/v2',
    'contracts/early-bird-membership/v1',
] as const;
const AUTHORITY_DIR = `${REPO_ROOT}${CONTRACT_DIRS[0]}`;

const checkoutSchema = JSON.parse(
    readFileSync(`${AUTHORITY_DIR}/checkout.schema.json`, 'utf8'),
) as {
    properties: {
        approval_url: {
            type: string;
            format?: string;
            minLength: number;
            maxLength: number;
            pattern: string;
        };
    };
};

// RFC 3986 `uri` format guard for the characters the schema pattern alone cannot
// exclude: whitespace and control characters are never valid inside a URI.
function isUriFormat(value: string): boolean {
    return !/[\x00-\x20\x7f]/.test(value);
}

const approvalUrlRules = checkoutSchema.properties.approval_url;
const approvalUrlPattern = new RegExp(approvalUrlRules.pattern);

function approvalUrlValid(value: unknown): boolean {
    return typeof value === 'string' &&
        value.length >= approvalUrlRules.minLength &&
        value.length <= approvalUrlRules.maxLength &&
        approvalUrlPattern.test(value) &&
        isUriFormat(value);
}

describe('early-bird-authority v1 checkout approval_url hardening', () => {
    it('declares a bounded credential-free HTTPS URI in the shipped schema', () => {
        expect(approvalUrlRules.type).toBe('string');
        expect(approvalUrlRules.format).toBe('uri');
        expect(approvalUrlRules.minLength).toBe(9);
        expect(approvalUrlRules.maxLength).toBe(2048);
        expect(approvalUrlRules.pattern).toBe('^https://[^\\s/@]+(?:[/?#][^\\s]*)?$');
    });

    it.each([
        ['http URL', 'http://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T'],
        ['protocol-relative URL', '//www.sandbox.paypal.com/checkoutnow?token=ABC'],
        ['relative URL', '/checkout/v1/redirect?pref_id=123'],
        ['bare path', 'checkout/v1/redirect'],
        ['embedded credentials', 'https://user:pass@www.sandbox.paypal.com/checkoutnow?token=ABC'],
        ['embedded username only', 'https://user@www.sandbox.paypal.com/checkoutnow?token=ABC'],
        ['whitespace in path', 'https://www.sandbox.paypal.com/checkout now?token=ABC'],
        ['tab in path', 'https://www.sandbox.paypal.com/checkout\tnow?token=ABC'],
        ['newline in query', 'https://www.sandbox.paypal.com/checkoutnow?token=ABC\nDEF'],
        ['control character in path', 'https://www.sandbox.paypal.com/\x01checkout'],
        ['missing host', 'https://'],
        ['over 2048 characters', `https://www.sandbox.paypal.com/${'a'.repeat(2048)}`],
    ])('rejects %s', (_label, value) => {
        expect(approvalUrlValid(value)).toBe(false);
    });

    it.each([
        [
            'PayPal sandbox approval URL',
            'https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T',
        ],
        [
            'PayPal sandbox subscription approval URL',
            'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-8A023366GG255991N',
        ],
        [
            'Mercado Pago sandbox approval URL',
            'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=123456789-0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
        ],
        [
            'Mercado Pago Argentina sandbox preapproval URL',
            'https://sandbox.mercadopago.com.ar/subscriptions/checkout?preapproval_id=2c938084726fca120172710000000000',
        ],
    ])('accepts %s', (_label, value) => {
        expect(approvalUrlValid(value)).toBe(true);
    });

    it('accepts exactly 2048 characters', () => {
        const value = `https://www.sandbox.paypal.com/${'a'.repeat(2048 - 31)}`;
        expect(value).toHaveLength(2048);
        expect(approvalUrlValid(value)).toBe(true);
    });

    it('ships a checkout fixture whose approval_url passes the hardened rules', () => {
        const fixture = JSON.parse(readFileSync(`${AUTHORITY_DIR}/checkout.fixture.json`, 'utf8'));
        expect(fixture.schema_version).toBe('early-bird-authority.checkout.v1');
        expect(approvalUrlValid(fixture.approval_url)).toBe(true);
    });
});

describe('Listener authority contract manifests', () => {
    it.each(CONTRACT_DIRS)('%s SHA256SUMS matches the shipped bytes', (dir) => {
        const manifest = readFileSync(`${REPO_ROOT}${dir}/SHA256SUMS`, 'utf8');
        for (const line of manifest.split('\n').filter(Boolean)) {
            const [expected, filename] = line.split('  ');
            const actual = createHash('sha256')
                .update(readFileSync(`${REPO_ROOT}${dir}/${filename}`))
                .digest('hex');
            expect(actual, `${dir}/${filename}`).toBe(expected);
        }
    });
});

const BACKEND_REPO = process.env.EARLY_BIRDS_BACKEND_REPO ?? '/home/nicolas/Projects/proyecciones-mito';
const BACKEND_COMMIT = 'e5e638a78d5e835bfb3cfa7be69740f0003ffb01';
const backendAvailable = existsSync(`${BACKEND_REPO}/.git`);

// Git hooks (e.g. the pre-commit suite run) export GIT_DIR and friends, which
// would override the `-C` target repo; scrub them so the canonical read is
// always the pinned backend commit.
function canonicalGitEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
        if (key.startsWith('GIT_')) delete env[key];
    }
    return env;
}

describe.skipIf(!backendAvailable)(`byte-equivalence with canonical backend ${BACKEND_COMMIT.slice(0, 7)}`, () => {
    for (const dir of CONTRACT_DIRS) {
        const files = readdirSync(`${REPO_ROOT}${dir}`).sort();
        it.each(files)(`${dir}/%s is byte-identical`, (filename) => {
            const canonical = execFileSync(
                'git',
                ['-C', BACKEND_REPO, 'show', `${BACKEND_COMMIT}:${dir}/${filename}`],
                { env: canonicalGitEnv() },
            );
            const local = readFileSync(`${REPO_ROOT}${dir}/${filename}`);
            expect(local.equals(canonical)).toBe(true);
        });
    }
});
