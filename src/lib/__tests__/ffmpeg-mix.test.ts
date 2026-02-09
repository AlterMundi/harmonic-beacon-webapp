import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process');

import { execFile } from 'child_process';
import { renderMixdown, type MixTrack } from '../ffmpeg-mix';

describe('renderMixdown', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('calls execFile with ffmpeg command', async () => {
        vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, cb) => {
            (cb as (err: Error | null) => void)(null);
            return {} as ReturnType<typeof execFile>;
        });

        const tracks: MixTrack[] = [{ filePath: '/data/track.ogg', category: 'SESSION' }];
        await renderMixdown({ tracks, inSeconds: 0, outSeconds: 10, mix: 1, outputPath: '/out.ogg' });

        expect(execFile).toHaveBeenCalledWith(
            'ffmpeg',
            expect.any(Array),
            expect.objectContaining({ timeout: 120000 }),
            expect.any(Function),
        );
    });

    it('builds correct -ss and -t args from inSeconds/outSeconds', async () => {
        vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, cb) => {
            (cb as (err: Error | null) => void)(null);
            return {} as ReturnType<typeof execFile>;
        });

        const tracks: MixTrack[] = [{ filePath: '/data/track.ogg', category: 'SESSION' }];
        await renderMixdown({ tracks, inSeconds: 5, outSeconds: 20, mix: 1, outputPath: '/out.ogg' });

        const args = vi.mocked(execFile).mock.calls[0][1] as string[];
        expect(args).toContain('-ss');
        expect(args).toContain('5');
        expect(args).toContain('-t');
        expect(args).toContain('15');
    });

    it('applies SESSION volume = mix and BEACON volume = 1-mix', async () => {
        vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, cb) => {
            (cb as (err: Error | null) => void)(null);
            return {} as ReturnType<typeof execFile>;
        });

        const tracks: MixTrack[] = [
            { filePath: '/data/session.ogg', category: 'SESSION' },
            { filePath: '/data/beacon.ogg', category: 'BEACON' },
        ];
        await renderMixdown({ tracks, inSeconds: 0, outSeconds: 10, mix: 0.7, outputPath: '/out.ogg' });

        const args = vi.mocked(execFile).mock.calls[0][1] as string[];
        const filterIdx = args.indexOf('-filter_complex');
        const filterArg = args[filterIdx + 1];
        expect(filterArg).toContain('volume=0.7');   // SESSION
        expect(filterArg).toContain('volume=0.3');   // BEACON (1-0.7=0.3)
    });

    it('clamps volume to 0.001 minimum', async () => {
        vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, cb) => {
            (cb as (err: Error | null) => void)(null);
            return {} as ReturnType<typeof execFile>;
        });

        const tracks: MixTrack[] = [
            { filePath: '/data/session.ogg', category: 'SESSION' },
            { filePath: '/data/beacon.ogg', category: 'BEACON' },
        ];
        await renderMixdown({ tracks, inSeconds: 0, outSeconds: 10, mix: 0, outputPath: '/out.ogg' });

        const args = vi.mocked(execFile).mock.calls[0][1] as string[];
        const filterIdx = args.indexOf('-filter_complex');
        const filterArg = args[filterIdx + 1];
        // SESSION track with mix=0 should be clamped to 0.001
        expect(filterArg).toContain('volume=0.001');
    });

    it('uses [out] label directly for single track', async () => {
        vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, cb) => {
            (cb as (err: Error | null) => void)(null);
            return {} as ReturnType<typeof execFile>;
        });

        const tracks: MixTrack[] = [{ filePath: '/data/track.ogg', category: 'SESSION' }];
        await renderMixdown({ tracks, inSeconds: 0, outSeconds: 10, mix: 1, outputPath: '/out.ogg' });

        const args = vi.mocked(execFile).mock.calls[0][1] as string[];
        const filterIdx = args.indexOf('-filter_complex');
        const filterArg = args[filterIdx + 1];
        expect(filterArg).toContain('[out]');
        expect(filterArg).not.toContain('amix');
    });

    it('uses amix for multiple tracks', async () => {
        vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, cb) => {
            (cb as (err: Error | null) => void)(null);
            return {} as ReturnType<typeof execFile>;
        });

        const tracks: MixTrack[] = [
            { filePath: '/data/a.ogg', category: 'SESSION' },
            { filePath: '/data/b.ogg', category: 'BEACON' },
        ];
        await renderMixdown({ tracks, inSeconds: 0, outSeconds: 10, mix: 0.5, outputPath: '/out.ogg' });

        const args = vi.mocked(execFile).mock.calls[0][1] as string[];
        const filterIdx = args.indexOf('-filter_complex');
        const filterArg = args[filterIdx + 1];
        expect(filterArg).toContain('amix=inputs=2:duration=longest');
    });

    it('rejects with descriptive error on ffmpeg failure', async () => {
        vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, cb) => {
            (cb as (err: Error | null, stdout: string, stderr: string) => void)(
                new Error('exit code 1'), '', 'ffmpeg error details'
            );
            return {} as ReturnType<typeof execFile>;
        });

        const tracks: MixTrack[] = [{ filePath: '/data/track.ogg', category: 'SESSION' }];
        await expect(
            renderMixdown({ tracks, inSeconds: 0, outSeconds: 10, mix: 1, outputPath: '/out.ogg' })
        ).rejects.toThrow('ffmpeg failed');
    });
});
