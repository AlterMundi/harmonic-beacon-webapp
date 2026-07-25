import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getAudioDurationSeconds, AudioDurationError } from '../audio-duration';

/**
 * These run ffprobe for real rather than mocking it. Mocking would assert that
 * the code parses a string this test wrote, which is not the thing that can
 * break — what breaks is ffprobe's actual output shape, and only the real binary
 * tells us about that.
 *
 * ffprobe ships with ffmpeg, which the Dockerfile already installs. If it is
 * missing locally these skip rather than fail, so a contributor without ffmpeg
 * is not blocked by a red suite they cannot fix.
 */
function hasFfmpeg(): boolean {
    try {
        execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

const available = hasFfmpeg();
const describeIfFfmpeg = available ? describe : describe.skip;

describeIfFfmpeg('getAudioDurationSeconds', () => {
    let dir: string;

    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'audio-duration-'));
    });

    afterAll(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    /** Generate a silent file of a known length with ffmpeg. */
    function makeAudio(name: string, seconds: number): string {
        const path = join(dir, name);
        execFileSync('ffmpeg', [
            '-f', 'lavfi',
            '-i', `anullsrc=r=44100:cl=mono`,
            '-t', String(seconds),
            '-c:a', 'libopus',
            '-y', path,
        ], { stdio: 'ignore' });
        return path;
    }

    it('reads the duration of a real audio file', async () => {
        const path = makeAudio('five.ogg', 5);
        const duration = await getAudioDurationSeconds(path);
        // Encoders pad slightly; assert the value is right, not bit-exact.
        expect(duration).toBeGreaterThanOrEqual(4);
        expect(duration).toBeLessThanOrEqual(6);
    });

    it('rounds to whole seconds', async () => {
        const path = makeAudio('fractional.ogg', 2.4);
        const duration = await getAudioDurationSeconds(path);
        expect(Number.isInteger(duration)).toBe(true);
    });

    it('throws AudioDurationError on a file that is not audio', async () => {
        const path = join(dir, 'not-audio.ogg');
        writeFileSync(path, 'this is not an audio file');
        await expect(getAudioDurationSeconds(path)).rejects.toBeInstanceOf(AudioDurationError);
    });

    it('throws AudioDurationError when the file does not exist', async () => {
        await expect(
            getAudioDurationSeconds(join(dir, 'absent.ogg')),
        ).rejects.toBeInstanceOf(AudioDurationError);
    });

    it('does not interpret a filename as a shell command', async () => {
        // execFile with an argument array, never a shell. A filename containing
        // shell metacharacters must be treated as a name and nothing else.
        const nasty = join(dir, 'x; touch pwned.txt');
        writeFileSync(nasty, 'not audio');

        await expect(getAudioDurationSeconds(nasty)).rejects.toBeInstanceOf(AudioDurationError);
        // The injected command must not have run.
        expect(() => execFileSync('test', ['-f', join(dir, 'pwned.txt')])).toThrow();
    });
});

describe('AudioDurationError', () => {
    it('is named so callers can distinguish it', () => {
        expect(new AudioDurationError('x').name).toBe('AudioDurationError');
    });
});
