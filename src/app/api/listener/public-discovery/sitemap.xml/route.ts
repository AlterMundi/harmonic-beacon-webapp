import {
    isCanonicalListenerHost,
    listenerSitemapXml,
} from '@/lib/listener/public-discovery';

const PUBLIC_CACHE = 'public, max-age=300, stale-while-revalidate=3600';

export function GET(request: Request): Response {
    if (!isCanonicalListenerHost(request.headers)) {
        return new Response(null, { status: 404 });
    }

    return new Response(listenerSitemapXml(), {
        headers: {
            'Cache-Control': PUBLIC_CACHE,
            'Content-Type': 'application/xml; charset=utf-8',
        },
    });
}
