import { changeAccountPassword } from '@/lib/account/credential-actions';
import { ACCOUNT_SESSION_COOKIE, isAccountHost } from '@/lib/account/config';

export async function POST(request: Request): Promise<Response> {
    if (!isAccountHost(request.headers.get('host') ?? new URL(request.url).host)) {
        return new Response(null, { status: 404 });
    }
    const body = await request.json().catch(() => null) as {
        currentPassword?: unknown; newPassword?: unknown;
    } | null;
    const status = await changeAccountPassword(request, body?.currentPassword, body?.newPassword);
    return Response.json({ status }, {
        status: status ? 200 : 400,
        headers: {
            'Cache-Control': 'private, no-store',
            ...(status ? {
                'Set-Cookie': `${ACCOUNT_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
            } : {}),
        },
    });
}
