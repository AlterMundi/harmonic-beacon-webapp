// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ThumbnailTapestry from '../ThumbnailTapestry';

afterEach(() => cleanup());

describe('ThumbnailTapestry', () => {
    it('omits cookies when loading the public composite', async () => {
        URL.createObjectURL = vi.fn(() => 'blob:tapestry');
        URL.revokeObjectURL = vi.fn();
        global.fetch = vi.fn().mockResolvedValue(new Response(new Blob(['jpeg']), { status: 200 }));
        render(<ThumbnailTapestry sessionId="session-1" />);
        await waitFor(() => expect(fetch).toHaveBeenCalled());
        expect(vi.mocked(fetch).mock.calls[0][1]?.credentials).toBe('omit');
    });
});
