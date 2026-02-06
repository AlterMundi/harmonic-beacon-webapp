import { NextRequest, NextResponse } from 'next/server';

const GO2RTC_API_URL = process.env.GO2RTC_API_URL || 'http://localhost:1984';

/**
 * GET /api/meditations/[id]/webrtc
 * Returns WebRTC connection info for a meditation stream
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: meditationId } = await params;
        const streamName = `meditation-${meditationId}`;

        // Get WebRTC offer from go2rtc
        const go2rtcUrl = `${GO2RTC_API_URL}/api/webrtc?src=${streamName}`;

        return NextResponse.json({
            webrtcUrl: go2rtcUrl,
            streamName,
            meditationId,
        });
    } catch (error) {
        console.error('Error getting WebRTC info:', error);
        return NextResponse.json(
            { error: 'Failed to get WebRTC info' },
            { status: 500 }
        );
    }
}
