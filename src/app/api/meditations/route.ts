import { NextRequest, NextResponse } from 'next/server';
import { readdir, stat } from 'fs/promises';
import { join, basename } from 'path';

// Configuration - supports both local dev and production server
const GO2RTC_API_URL = process.env.GO2RTC_INTERNAL_URL || process.env.GO2RTC_API_URL || 'http://localhost:1984';

// Storage path - local in dev, server path in production
const MEDITATIONS_PATH = process.env.MEDITATIONS_STORAGE_PATH
    || join(process.cwd(), 'public/audio/meditations');

// Meditation metadata
interface Meditation {
    id: string;
    name: string;
    fileName: string;
    streamName: string;
    duration?: number;
}

// Hardcoded meditation metadata (can be moved to database later)
const MEDITATION_METADATA: Record<string, { name: string }> = {
    'amor': { name: 'El Amor' },
    'humanosfera': { name: 'Humanosfera' },
    'la_mosca': { name: 'La Mosca' },
};

/**
 * Sanitize path to prevent directory traversal attacks
 */
function sanitizePath(input: string): string {
    // Remove any path components
    return basename(input).replace(/[^a-zA-Z0-9_-]/g, '');
}

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

        // Sanitize meditation ID to prevent path traversal
        const sanitizedId = sanitizePath(meditationId);
        if (sanitizedId !== meditationId) {
            return NextResponse.json(
                { error: 'Invalid meditation ID' },
                { status: 400 }
            );
        }

        // Get meditation file path
        const files = await readdir(MEDITATIONS_PATH);
        const meditationFile = files.find(f => f.startsWith(sanitizedId));

        if (!meditationFile) {
            return NextResponse.json(
                { error: 'Meditation not found' },
                { status: 404 }
            );
        }

        const filePath = join(MEDITATIONS_PATH, meditationFile);
        const streamName = `meditation-${sanitizedId}`;

        // Verify file exists and is within storage path
        try {
            const fileStats = await stat(filePath);
            if (!fileStats.isFile()) {
                throw new Error('Not a file');
            }
        } catch {
            return NextResponse.json(
                { error: 'Meditation file not accessible' },
                { status: 404 }
            );
        }

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
            const errorText = await go2rtcResponse.text();
            console.error('go2rtc error:', errorText);
            throw new Error(`go2rtc API error: ${go2rtcResponse.status}`);
        }

        return NextResponse.json({
            success: true,
            streamName,
            meditationId: sanitizedId,
            name: MEDITATION_METADATA[sanitizedId]?.name || sanitizedId,
        });
    } catch (error) {
        console.error('Error creating meditation stream:', error);
        return NextResponse.json(
            { error: 'Failed to create meditation stream' },
            { status: 500 }
        );
    }
}

