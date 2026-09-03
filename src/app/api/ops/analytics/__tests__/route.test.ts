import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    effectiveAnalyticsRole: vi.fn(),
    fetchAnalyticsDashboard: vi.fn(),
    resolveStaffSession: vi.fn(),
}));

vi.mock('@/lib/analytics-access', () => ({
    effectiveAnalyticsRole: mocks.effectiveAnalyticsRole,
    fetchAnalyticsDashboard: mocks.fetchAnalyticsDashboard,
}));
vi.mock('@/lib/ops-auth', () => ({ resolveStaffSession: mocks.resolveStaffSession }));

import { GET } from '../route';

describe('analytics API calendar filters', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveStaffSession.mockResolvedValue({ id: 'admin-1', role: 'ADMIN' });
        mocks.effectiveAnalyticsRole.mockResolvedValue('ADMIN');
        mocks.fetchAnalyticsDashboard.mockResolvedValue({ summary: {} });
    });

    it('uses equal inclusive calendar spans for current and previous comparisons', async () => {
        const request = new NextRequest('https://live.harmonicbeacon.com/api/ops/analytics?start=2026-08-05&end=2026-09-03&timezone=America%2FArgentina%2FCordoba&traffic=real&compare=previous');
        const response = await GET(request);

        expect(response.status).toBe(200);
        expect(mocks.fetchAnalyticsDashboard).toHaveBeenCalledTimes(2);
        expect(mocks.fetchAnalyticsDashboard.mock.calls[0][0].filters).toMatchObject({
            start: '2026-08-05', end: '2026-09-03', timezone: 'America/Argentina/Cordoba',
        });
        expect(mocks.fetchAnalyticsDashboard.mock.calls[1][0].filters).toMatchObject({
            start: '2026-07-06', end: '2026-08-04', timezone: 'America/Argentina/Cordoba',
        });
    });

    it.each([
        'start=2026-09-04&end=2026-09-03&timezone=UTC',
        'start=2026-02-30&end=2026-03-01&timezone=UTC',
        'start=2026-09-03&end=2026-09-03&timezone=Mars%2FOlympus',
        'start=2026-09-03&timezone=UTC',
        'timezone=Mars%2FOlympus',
    ])('rejects an invalid calendar selection before querying analytics: %s', async query => {
        const response = await GET(new NextRequest(`https://live.harmonicbeacon.com/api/ops/analytics?${query}`));
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: 'invalid_date_range' });
        expect(mocks.fetchAnalyticsDashboard).not.toHaveBeenCalled();
    });
});
