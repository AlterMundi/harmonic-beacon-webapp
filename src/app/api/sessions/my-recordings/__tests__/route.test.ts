import { describe, expect, it } from 'vitest';

import { parseResponse } from '@/__tests__/helpers';

describe('GET /api/sessions/my-recordings', () => {
    it('is permanently disabled', async () => {
        const { GET } = await import('../route');
        const { status, body } = await parseResponse(await GET());

        expect(status).toBe(410);
        expect(body).toEqual({ error: 'Recording is disabled' });
    });
});
