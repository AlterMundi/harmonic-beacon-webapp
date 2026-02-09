import { execFile } from 'child_process';

export interface MixTrack {
    filePath: string;
    category: 'SESSION' | 'BEACON';
}

interface RenderMixdownOptions {
    tracks: MixTrack[];
    inSeconds: number;
    outSeconds: number;
    mix: number; // 0 = all beacon, 1 = all session
    outputPath: string;
}

/**
 * Render a mixdown of multiple audio tracks with crossfader mix baked in.
 * Uses execFile (no shell) — safe from injection.
 */
export function renderMixdown({ tracks, inSeconds, outSeconds, mix, outputPath }: RenderMixdownOptions): Promise<void> {
    return new Promise((resolve, reject) => {
        const duration = outSeconds - inSeconds;
        const args: string[] = [];

        // Inputs: -ss {in} -t {duration} -i {filePath}
        for (const track of tracks) {
            args.push('-ss', String(inSeconds), '-t', String(duration), '-i', track.filePath);
        }

        // Build filter_complex
        const filterParts: string[] = [];
        const mixLabels: string[] = [];

        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            let vol: number;
            if (track.category === 'SESSION') {
                vol = mix;
            } else {
                vol = 1 - mix;
            }
            // Clamp to avoid silent-track amix issues
            vol = Math.max(vol, 0.001);

            const label = `a${i}`;
            filterParts.push(`[${i}:a]volume=${vol}[${label}]`);
            mixLabels.push(`[${label}]`);
        }

        if (tracks.length === 1) {
            // Single track: volume filter straight to output
            filterParts[0] = `[0:a]volume=${Math.max(tracks[0].category === 'SESSION' ? mix : 1 - mix, 0.001)}[out]`;
        } else {
            // Multiple tracks: amix
            filterParts.push(`${mixLabels.join('')}amix=inputs=${tracks.length}:duration=longest[out]`);
        }

        args.push('-filter_complex', filterParts.join(';'));
        args.push('-map', '[out]', '-c:a', 'libopus', '-b:a', '64k', '-vn', outputPath);

        const child = execFile('ffmpeg', args, { timeout: 120_000 }, (error, _stdout, stderr) => {
            if (error) {
                reject(new Error(`ffmpeg failed: ${error.message}\n${stderr}`));
            } else {
                resolve();
            }
        });

        child.on('error', (err) => {
            reject(new Error(`ffmpeg spawn error: ${err.message}`));
        });
    });
}
