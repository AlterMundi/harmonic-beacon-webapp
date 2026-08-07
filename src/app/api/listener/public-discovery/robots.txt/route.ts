import {
    isCanonicalListenerHost,
    listenerRobotsText,
} from '@/lib/listener/public-discovery';

const PUBLIC_CACHE = 'public, max-age=300, stale-while-revalidate=3600';

export function GET(request: Request): Response {
    if (!isCanonicalListenerHost(request.headers)) {
        return new Response(null, { status: 404 });
    }

    return new Response(listenerRobotsText(), {
        headers: {
            'Cache-Control': PUBLIC_CACHE,
            'Content-Type': 'text/plain; charset=utf-8',
        },
    });
}
