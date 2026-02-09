import { createReadStream, statSync } from 'fs';
import { Readable } from 'stream';

/**
 * Stream a file as a Response with Range request support.
 * Returns null if the file doesn't exist.
 */
export function streamFile(filePath: string, rangeHeader: string | null): Response | null {
    let stat;
    try {
        stat = statSync(filePath);
    } catch {
        return null;
    }

    const fileSize = stat.size;

    if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (match) {
            const start = parseInt(match[1], 10);
            const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
            const chunkSize = end - start + 1;

            const stream = createReadStream(filePath, { start, end });
            const webStream = Readable.toWeb(stream) as ReadableStream;

            return new Response(webStream, {
                status: 206,
                headers: {
                    'Content-Type': 'audio/ogg',
                    'Content-Length': String(chunkSize),
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Cache-Control': 'private, max-age=3600',
                },
            });
        }
    }

    const stream = createReadStream(filePath);
    const webStream = Readable.toWeb(stream) as ReadableStream;

    return new Response(webStream, {
        status: 200,
        headers: {
            'Content-Type': 'audio/ogg',
            'Content-Length': String(fileSize),
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'private, max-age=3600',
        },
    });
}
