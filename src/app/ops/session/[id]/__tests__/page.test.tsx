import { describe, expect, it, vi } from 'vitest';

const redirect = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ redirect }));

import LegacyOpsSessionPage from '../page';

describe('legacy spotlight bookmark', () => {
    it('redirects once to the canonical event route', async () => {
        await LegacyOpsSessionPage({ params: Promise.resolve({ id: 'event-1' }) });
        expect(redirect).toHaveBeenCalledOnce();
        expect(redirect).toHaveBeenCalledWith('/ops/events/event-1');
    });
});
