import { describe, expect, it } from 'vitest';

import { GET, POST } from '../route';

describe('retired welcome access authority', () => {
    it.each([['GET', GET], ['POST', POST]])('returns private 410 for %s', async (_method, handler) => {
        const response = await handler();
        expect(response.status).toBe(410);
        expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
        await expect(response.json()).resolves.toMatchObject({ reason: 'quota_policy_replaced' });
    });
});
