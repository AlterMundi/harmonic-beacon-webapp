import { execFile } from 'child_process';

/**
 * Read an audio file's duration with ffprobe.
 *
 * Uploads previously stored `durationSeconds = 0` for every meditation, and no
 * edit path could correct it. That made two documented rules unenforceable: the
 * `completed` threshold in BUSINESS_RULES.md §2.3 is a fraction of the declared
 * duration, and the reviewer's "duration matches declared" check in
 * CONTENT_POLICY.md had nothing to compare against.
 *
 * Uses `execFile` with an argument array — never a shell — so a filename can
 * never be interpreted as a command. `src/lib/ffmpeg-mix.ts` takes the same
 * approach for the same reason.
 */

/** ffprobe on a large file is still fast; this only bounds a pathological case. */
const PROBE_TIMEOUT_MS = 30_000;

export class AudioDurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AudioDurationError';
    }
}

/**
 * Returns the duration in whole seconds, rounded to nearest.
 *
 * Throws `AudioDurationError` when ffprobe fails or reports something that is
 * not a usable duration. Callers decide whether that is fatal — for an upload it
 * should not be, since a file that plays fine can still confuse a probe, and
 * refusing the upload would be a worse outcome than an unknown duration.
 */
export function getAudioDurationSeconds(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const args = [
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            filePath,
        ];

        const child = execFile('ffprobe', args, { timeout: PROBE_TIMEOUT_MS }, (error, stdout, stderr) => {
            if (error) {
                reject(new AudioDurationError(`ffprobe failed: ${error.message}${stderr ? `\n${stderr}` : ''}`));
                return;
            }

            const raw = stdout.trim();
            const seconds = Number.parseFloat(raw);

            // ffprobe reports "N/A" for containers it cannot measure, and can
            // exit 0 while doing so. NaN, Infinity and negatives all mean the
            // same thing here: no usable duration.
            if (!Number.isFinite(seconds) || seconds < 0) {
                reject(new AudioDurationError(`ffprobe returned no usable duration (got ${JSON.stringify(raw)})`));
                return;
            }

            resolve(Math.round(seconds));
        });

        child.on('error', (err) => {
            reject(new AudioDurationError(`ffprobe spawn error: ${err.message}`));
        });
    });
}
