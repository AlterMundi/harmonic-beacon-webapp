import { describe, expect, it } from 'vitest';

import { parseResponse } from '@/__tests__/helpers';

describe('POST /api/provider/sessions/[id]/recording/stop', () => {
    it('is permanently disabled and exposes no egress path', async () => {
        const { POST } = await import('../route');
        const { status, body } = await parseResponse(await POST());

        expect(status).toBe(410);
        expect(body).toEqual({ error: 'Recording is disabled' });
    });
});
