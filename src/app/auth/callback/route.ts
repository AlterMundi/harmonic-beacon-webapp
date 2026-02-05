import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

export async function GET(request: Request) {
    const requestUrl = new URL(request.url);
    const code = requestUrl.searchParams.get('code');

    if (code) {
        await supabase.auth.exchangeCodeForSession(code);
    }

    // Get the actual origin from forwarded headers (nginx proxy)
    const headersList = await headers();
    const forwardedHost = headersList.get('x-forwarded-host');
    const forwardedProto = headersList.get('x-forwarded-proto') || 'https';
    const origin = forwardedHost
        ? `${forwardedProto}://${forwardedHost}`
        : requestUrl.origin;

    // Redirect to profile page after successful auth
    return NextResponse.redirect(new URL('/profile', origin));
}
