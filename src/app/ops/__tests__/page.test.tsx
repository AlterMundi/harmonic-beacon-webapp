import { describe, expect, it, vi } from 'vitest';

const redirect = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ redirect }));

import OpsPage from '../page';

describe('ops entry point', () => {
    it('converges on the canonical event hub', () => {
        OpsPage();
        expect(redirect).toHaveBeenCalledWith('/ops/events');
    });
});
