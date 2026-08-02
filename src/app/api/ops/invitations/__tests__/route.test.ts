import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest, parseResponse } from '@/__tests__/helpers';

const mocks = vi.hoisted(() => ({
    resolveStaffSession: vi.fn(),
    queryRaw: vi.fn(),
    sessionFindUnique: vi.fn(),
    campaignCreate: vi.fn(),
    campaignFindMany: vi.fn(),
    auditCreate: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        $queryRaw: mocks.queryRaw,
        $transaction: vi.fn(),
        scheduledSession: { findUnique: mocks.sessionFindUnique },
        promoInvitation: {
            create: mocks.campaignCreate,
            findMany: mocks.campaignFindMany,
        },
        auditLog: { create: mocks.auditCreate },
    };
    prisma.$transaction.mockImplementation(
        async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
    );
    return { prisma };
});
vi.mock('@/lib/ops-auth', () => ({ resolveStaffSession: mocks.resolveStaffSession }));

import { GET, POST } from '../route';

const PEPPER = 'promo-route-test-pepper-at-least-32-characters';
const ADMIN = {
    id: 'admin-1',
    email: 'admin@example.invalid',
    name: 'Admin',
    role: 'ADMIN',
};
const SESSION = {
    id: '10000000-0000-4000-8000-000000000001',
    title: 'Spanish event',
    language: 'SPANISH',
    roomName: 'spanish-room',
    status: 'SCHEDULED',
    scheduledAt: new Date('2026-08-08T14:30:00.000Z'),
    attendeeCap: 150,
};
const CAMPAIGN = {
    id: '50000000-0000-4000-8000-000000000001',
    label: 'Guest list',
    status: 'ACTIVE',
    expiresAt: new Date('2026-08-04T12:00:00.000Z'),
    maxRedemptions: 10,
    redemptionCount: 0,
    disabledAt: null,
    createdAt: new Date('2026-08-02T12:00:00.000Z'),
    scheduledSession: SESSION,
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubEnv('TICKET_CODE_PEPPER', PEPPER);
    vi.stubEnv('PROMO_INVITATIONS_ENABLED', 'false');
    vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'));
    mocks.resolveStaffSession.mockResolvedValue(ADMIN);
    mocks.sessionFindUnique.mockResolvedValue(SESSION);
    mocks.campaignCreate.mockResolvedValue(CAMPAIGN);
    mocks.campaignFindMany.mockResolvedValue([CAMPAIGN]);
    mocks.auditCreate.mockResolvedValue({});
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

describe('staff promotion invitations', () => {
    it('denies unauthenticated and incapable staff before reading campaigns', async () => {
        mocks.resolveStaffSession.mockResolvedValueOnce(null);
        expect((await GET(createRequest('/api/ops/invitations'))).status).toBe(401);

        mocks.resolveStaffSession.mockResolvedValueOnce({ ...ADMIN, role: 'FACILITATOR' });
        const response = await POST(createRequest('/api/ops/invitations', {
            method: 'POST',
            body: {},
        }));
        expect(response.status).toBe(403);
        expect(mocks.campaignCreate).not.toHaveBeenCalled();
    });

    it('lists only redacted campaign metadata and reports the global kill switch', async () => {
        const { status, body } = await parseResponse(await GET(createRequest('/api/ops/invitations')));

        expect(status).toBe(200);
        expect(body).toMatchObject({
            redemptionEnabled: false,
            campaigns: [{ id: CAMPAIGN.id, label: 'Guest list', redemptionCount: 0 }],
        });
        expect(JSON.stringify(body)).not.toMatch(/codeDigest|NICO100|admin@example/i);
    });

    it('creates a session-scoped bounded campaign without persisting or echoing its raw code', async () => {
        const response = await POST(createRequest('/api/ops/invitations', {
            method: 'POST',
            body: {
                sessionId: SESSION.id,
                code: 'NICO100',
                label: 'Guest list',
                expiresAt: '2026-08-04T12:00:00.000Z',
                maxRedemptions: 10,
            },
        }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(201);
        const data = mocks.campaignCreate.mock.calls[0][0].data;
        expect(data).toMatchObject({
            scheduledSessionId: SESSION.id,
            label: 'Guest list',
            maxRedemptions: 10,
            issuedByUserId: ADMIN.id,
        });
        expect(data.codeDigest).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.stringify(data)).not.toContain('NICO100');
        expect(JSON.stringify(body)).not.toMatch(/NICO100|codeDigest/);
        expect(mocks.queryRaw).toHaveBeenCalledOnce();
        expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ action: 'promo.create' }),
        }));
    });

    it('rejects malformed, over-capacity, and long-lived campaigns before mutation', async () => {
        for (const body of [
            { sessionId: SESSION.id, code: 'tiny', label: 'Guest list', expiresAt: '2026-08-04T12:00:00.000Z', maxRedemptions: 1 },
            { sessionId: SESSION.id, code: 'NICO100', label: 'Guest list', expiresAt: '2026-08-04T12:00:00.000Z', maxRedemptions: 151 },
            { sessionId: SESSION.id, code: 'NICO100', label: 'Guest list', expiresAt: '2026-08-20T12:00:00.000Z', maxRedemptions: 1 },
        ]) {
            const response = await POST(createRequest('/api/ops/invitations', { method: 'POST', body }));
            expect(response.status).toBe(400);
        }
        expect(mocks.campaignCreate).not.toHaveBeenCalled();
    });
});
