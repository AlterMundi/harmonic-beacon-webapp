import { NextRequest, NextResponse } from 'next/server';

// go2rtc internal API URL (not exposed to public)
const GO2RTC_INTERNAL_URL = process.env.GO2RTC_INTERNAL_URL || 'http://localhost:1984';

/**
 * GET /api/admin/go2rtc/config
 * Get current go2rtc configuration (admin only - protected by middleware)
 */
export async function GET(request: NextRequest) {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const response = await fetch(`${GO2RTC_INTERNAL_URL}/api/config`);
        if (!response.ok) {
            throw new Error(`go2rtc API error: ${response.status}`);
        }

        const config = await response.json();
        return NextResponse.json(config);
    } catch (error) {
        console.error('Error fetching go2rtc config:', error);
        return NextResponse.json(
            { error: 'Failed to fetch go2rtc configuration' },
            { status: 500 }
        );
    }
}

/**
 * PATCH /api/admin/go2rtc/config
 * Update go2rtc configuration (admin only - protected by middleware)
 */
export async function PATCH(request: NextRequest) {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();

        const response = await fetch(`${GO2RTC_INTERNAL_URL}/api/config`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`go2rtc API error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        return NextResponse.json(result);
    } catch (error) {
        console.error('Error updating go2rtc config:', error);
        return NextResponse.json(
            { error: 'Failed to update go2rtc configuration' },
            { status: 500 }
        );
    }
}
