import type { NextRequest } from 'next/server';

import { earlyBirdAuth } from '@/lib/early-birds/auth';

export const dynamic = 'force-dynamic';

export function GET(request: NextRequest): Promise<Response> {
    return earlyBirdAuth().handler(request);
}

export function POST(request: NextRequest): Promise<Response> {
    return earlyBirdAuth().handler(request);
}
