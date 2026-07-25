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

    // Derived from the constructor rather than the DOM `RequestInit`: NextRequest
    // takes its own RequestInit, and the two are not assignable. Deriving it here
    // avoids a deep import from next/dist that would break on upgrade.
    const init: NonNullable<ConstructorParameters<typeof NextRequest>[1]> = {
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

// Next.js 16 uses async params in route handlers.
// Generic in T so the specific key survives: a route declaring
// `{ params: Promise<{ id: string }> }` will not accept a widened
// `Promise<Record<string, string>>`, which is what a non-generic return type
// produced — and it accounted for ~100 type errors across the route tests.
export function mockParams<T extends Record<string, string>>(params: T): { params: Promise<T> } {
    return { params: Promise.resolve(params) };
}
