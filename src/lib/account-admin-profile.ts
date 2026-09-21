import { accountConfiguration } from '@/lib/account-rp';

export async function fetchAccountAdminProfile(issuer: string, subject: string) {
    const config = accountConfiguration();
    if (issuer !== config.issuer) return null;
    const response = await fetch(new URL('/api/account/admin-profile', `${issuer}/`), {
        method: 'POST',
        headers: {
            Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
            'Content-Type': 'application/json', Accept: 'application/json',
        },
        body: JSON.stringify({ sub: subject }),
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Account profile unavailable');
    const body = await response.json() as Record<string, unknown>;
    if (body.sub !== subject) throw new Error('Account profile subject mismatch');
    const bounded = (value: unknown, length: number) => typeof value === 'string' &&
        value.length <= length && !/[\p{Cc}\p{Cf}]/u.test(value) ? value : null;
    return {
        preferredName: bounded(body.preferredName, 60),
        realName: bounded(body.realName, 120),
        email: bounded(body.email, 320),
        emailVerified: typeof body.emailVerified === 'boolean' ? body.emailVerified : null,
    };
}
