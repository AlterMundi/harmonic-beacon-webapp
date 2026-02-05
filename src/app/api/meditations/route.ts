import { NextRequest, NextResponse } from 'next/server';
import { readdir } from 'fs/promises';
import { join } from 'path';

const GO2RTC_API_URL = process.env.GO2RTC_API_URL || 'http://localhost:1984';
const MEDITATIONS_PATH = join(process.cwd(), 'public/audio/meditations');

// Meditation metadata
interface Meditation {
    id: string;
    name: string;
    fileName: string;
    streamName: string;
}

// Hardcoded meditation metadata (can be moved to database later)
const MEDITATION_METADATA: Record<string, { name: string }> = {
    'amor': { name: 'El Amor' },
    'humanosfera': { name: 'Humanosfera' },
    'la_mosca': { name: 'La Mosca' },
};

/**
 * GET /api/meditations
 * Returns list of available meditations
 */
export async function GET() {
    try {
        // Read meditation files from directory
        const files = await readdir(MEDITATIONS_PATH);
        const audioFiles = files.filter(f => f.endsWith('.m4a') || f.endsWith('.mp3'));

        const meditations: Meditation[] = audioFiles.map(fileName => {
            const id = fileName.replace(/\.(m4a|mp3)$/, '');
            return {
                id,
                name: MEDITATION_METADATA[id]?.name || id,
                fileName,
                streamName: `meditation-${id}`,
            };
        });

        return NextResponse.json({ meditations });
    } catch (error) {
        console.error('Error listing meditations:', error);
        return NextResponse.json(
            { error: 'Failed to list meditations' },
            { status: 500 }
        );
    }
}

/**
 * POST /api/meditations
 * Creates a go2rtc stream for a meditation
 * Body: { meditationId: string }
 */
export async function POST(request: NextRequest) {
    try {
        const { meditationId } = await request.json();

        if (!meditationId) {
            return NextResponse.json(
                { error: 'meditationId is required' },
                { status: 400 }
            );
        }

        // Get meditation file path
        const files = await readdir(MEDITATIONS_PATH);
        const meditationFile = files.find(f => f.startsWith(meditationId));

        if (!meditationFile) {
            return NextResponse.json(
                { error: 'Meditation not found' },
                { status: 404 }
            );
        }

        const filePath = join(MEDITATIONS_PATH, meditationFile);
        const streamName = `meditation-${meditationId}`;

        // Create stream in go2rtc via API
        const go2rtcResponse = await fetch(`${GO2RTC_API_URL}/api/config`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                streams: {
                    [streamName]: [
                        `ffmpeg:${filePath}#audio=opus`,
                    ],
                },
            }),
        });

        if (!go2rtcResponse.ok) {
            throw new Error(`go2rtc API error: ${go2rtcResponse.statusText}`);
        }

        return NextResponse.json({
            success: true,
            streamName,
            meditationId,
            name: MEDITATION_METADATA[meditationId]?.name || meditationId,
        });
    } catch (error) {
        console.error('Error creating meditation stream:', error);
        return NextResponse.json(
            { error: 'Failed to create meditation stream' },
            { status: 500 }
        );
    }
}
