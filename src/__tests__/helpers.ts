import { NextRequest } from 'next/server';

interface RequestOptions {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    searchParams?: Record<string, string>;
}

export function createRequest(url: string, options: RequestOptions = {}): NextRequest {
    const { method = 'GET', body, headers = {}, searchParams = {} } = options;

    const fullUrl = new URL(url, 'http://localhost:3000');
    for (const [key, value] of Object.entries(searchParams)) {
        fullUrl.searchParams.set(key, value);
    }

    const init: RequestInit = {
        method,
        headers: new Headers(headers),
    };

    if (body !== undefined && method !== 'GET') {
        if (body instanceof FormData) {
            init.body = body;
        } else {
            init.body = JSON.stringify(body);
            (init.headers as Headers).set('Content-Type', 'application/json');
        }
    }

    return new NextRequest(fullUrl, init);
}

export async function parseResponse(response: Response): Promise<{ status: number; body: unknown }> {
    const status = response.status;
    let body: unknown;
    try {
        body = await response.json();
    } catch {
        body = null;
    }
    return { status, body };
}

// Next.js 16 uses async params in route handlers
export function mockParams(params: Record<string, string>): { params: Promise<Record<string, string>> } {
    return { params: Promise.resolve(params) };
}
