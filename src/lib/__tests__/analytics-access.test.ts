import type { StaffRole } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    findUnique: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
    prisma: {
        analyticsRoleGrant: {
            findUnique: mocks.findUnique,
        },
    },
}));

import { effectiveAnalyticsRole } from '@/lib/analytics-access';
import type { StaffPrincipal } from '@/lib/ops-auth';

function staff(role: StaffRole): StaffPrincipal {
    return {
        id: `staff-${role.toLowerCase()}`,
        email: `${role.toLowerCase()}@harmonicbeacon.com`,
        name: role,
        role,
    };
}

describe('effectiveAnalyticsRole', () => {
    beforeEach(() => {
        mocks.findUnique.mockReset();
        mocks.findUnique.mockResolvedValue(null);
    });

    it.each(['FACILITATOR', 'FACILITATOR_OP', 'OPERATOR'] as const)(
        'allows %s staff to view analytics without an explicit grant',
        async role => {
            await expect(effectiveAnalyticsRole(staff(role))).resolves.toBe('ANALYTICS_VIEWER');
        },
    );

    it('keeps ADMIN access and export authority without querying grants', async () => {
        await expect(effectiveAnalyticsRole(staff('ADMIN'))).resolves.toBe('ADMIN');
        expect(mocks.findUnique).not.toHaveBeenCalled();
    });

    it('upgrades staff with an active EXPORTER grant', async () => {
        mocks.findUnique.mockResolvedValue({ role: 'EXPORTER', revokedAt: null });

        await expect(effectiveAnalyticsRole(staff('OPERATOR'))).resolves.toBe('ANALYTICS_EXPORTER');
    });

    it('keeps staff view-only when an EXPORTER grant is revoked', async () => {
        mocks.findUnique.mockResolvedValue({ role: 'EXPORTER', revokedAt: new Date() });

        await expect(effectiveAnalyticsRole(staff('FACILITATOR'))).resolves.toBe('ANALYTICS_VIEWER');
    });
});
