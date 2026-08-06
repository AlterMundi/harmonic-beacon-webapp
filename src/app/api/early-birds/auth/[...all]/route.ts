import type { NextRequest } from 'next/server';

import { earlyBirdAuth } from '@/lib/early-birds/auth';
import {
    earlyBirdsEnabled,
    earlyBirdsUnavailableResponse,
} from '@/lib/early-birds/enabled';

export const dynamic = 'force-dynamic';

export function GET(request: NextRequest): Promise<Response> | Response {
    if (!earlyBirdsEnabled()) return earlyBirdsUnavailableResponse();
    return earlyBirdAuth().handler(request);
}

export function POST(request: NextRequest): Promise<Response> | Response {
    if (!earlyBirdsEnabled()) return earlyBirdsUnavailableResponse();
    return earlyBirdAuth().handler(request);
}
