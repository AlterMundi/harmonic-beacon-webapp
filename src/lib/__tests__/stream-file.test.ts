import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs');
vi.mock('stream', () => ({
    Readable: {
        toWeb: vi.fn().mockReturnValue(new ReadableStream()),
    },
}));

import { statSync, createReadStream } from 'fs';
import { streamFile } from '../stream-file';

describe('streamFile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns null when file does not exist', () => {
        vi.mocked(statSync).mockImplementation(() => { throw new Error('ENOENT'); });
        const result = streamFile('/nonexistent.ogg', null);
        expect(result).toBeNull();
    });

    it('returns 200 with full file when no Range header', () => {
        vi.mocked(statSync).mockReturnValue({ size: 5000 } as ReturnType<typeof statSync>);
        vi.mocked(createReadStream).mockReturnValue({} as ReturnType<typeof createReadStream>);

        const result = streamFile('/audio/test.ogg', null);
        expect(result).not.toBeNull();
        expect(result!.status).toBe(200);
        expect(result!.headers.get('Content-Type')).toBe('audio/ogg');
        expect(result!.headers.get('Content-Length')).toBe('5000');
        expect(result!.headers.get('Accept-Ranges')).toBe('bytes');
    });

    it('returns 206 for valid range request', () => {
        vi.mocked(statSync).mockReturnValue({ size: 5000 } as ReturnType<typeof statSync>);
        vi.mocked(createReadStream).mockReturnValue({} as ReturnType<typeof createReadStream>);

        const result = streamFile('/audio/test.ogg', 'bytes=0-1023');
        expect(result).not.toBeNull();
        expect(result!.status).toBe(206);
        expect(result!.headers.get('Content-Length')).toBe('1024');
        expect(result!.headers.get('Content-Range')).toBe('bytes 0-1023/5000');
    });

    it('handles open-ended range bytes=0-', () => {
        vi.mocked(statSync).mockReturnValue({ size: 5000 } as ReturnType<typeof statSync>);
        vi.mocked(createReadStream).mockReturnValue({} as ReturnType<typeof createReadStream>);

        const result = streamFile('/audio/test.ogg', 'bytes=0-');
        expect(result).not.toBeNull();
        expect(result!.status).toBe(206);
        expect(result!.headers.get('Content-Length')).toBe('5000');
        expect(result!.headers.get('Content-Range')).toBe('bytes 0-4999/5000');
    });

    it('handles mid-file range request', () => {
        vi.mocked(statSync).mockReturnValue({ size: 10000 } as ReturnType<typeof statSync>);
        vi.mocked(createReadStream).mockReturnValue({} as ReturnType<typeof createReadStream>);

        const result = streamFile('/audio/test.ogg', 'bytes=1000-2000');
        expect(result).not.toBeNull();
        expect(result!.status).toBe(206);
        expect(result!.headers.get('Content-Length')).toBe('1001');
        expect(result!.headers.get('Content-Range')).toBe('bytes 1000-2000/10000');
    });

    it('passes correct start/end to createReadStream for range', () => {
        vi.mocked(statSync).mockReturnValue({ size: 5000 } as ReturnType<typeof statSync>);
        vi.mocked(createReadStream).mockReturnValue({} as ReturnType<typeof createReadStream>);

        streamFile('/audio/test.ogg', 'bytes=100-500');
        expect(createReadStream).toHaveBeenCalledWith('/audio/test.ogg', { start: 100, end: 500 });
    });

    it('returns 200 when Range header is malformed', () => {
        vi.mocked(statSync).mockReturnValue({ size: 5000 } as ReturnType<typeof statSync>);
        vi.mocked(createReadStream).mockReturnValue({} as ReturnType<typeof createReadStream>);

        const result = streamFile('/audio/test.ogg', 'invalid-range');
        expect(result).not.toBeNull();
        expect(result!.status).toBe(200);
        expect(result!.headers.get('Content-Length')).toBe('5000');
    });

    it('includes Cache-Control header', () => {
        vi.mocked(statSync).mockReturnValue({ size: 100 } as ReturnType<typeof statSync>);
        vi.mocked(createReadStream).mockReturnValue({} as ReturnType<typeof createReadStream>);

        const result = streamFile('/audio/test.ogg', null);
        expect(result!.headers.get('Cache-Control')).toBe('private, max-age=3600');
    });
});
