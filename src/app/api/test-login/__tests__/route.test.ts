import { afterEach, describe, expect, it, vi } from 'vitest';

import { NextRequest } from 'next/server';

const prisma = vi.hoisted(() => ({
    scheduledSession: { findUnique: vi.fn() },
    ticketEntitlement: { create: vi.fn() },
    user: { upsert: vi.fn() },
    webSession: { create: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma }));

import { GET, POST } from '../route';

const originalGate = process.env.E2E_DASHBOARD_ENABLED;

afterEach(() => {
    vi.clearAllMocks();
    if (originalGate === undefined) {
        delete process.env.E2E_DASHBOARD_ENABLED;
    } else {
        process.env.E2E_DASHBOARD_ENABLED = originalGate;
    }
});

function postRequest(body = '{not-json'): NextRequest {
    return new NextRequest('http://localhost/api/test-login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
    });
}

describe('/api/test-login production gate', () => {
    it.each([undefined, '0', 'true'])('returns 404 before parsing or persistence when the gate is %s', async (value) => {
        if (value === undefined) {
            delete process.env.E2E_DASHBOARD_ENABLED;
        } else {
            process.env.E2E_DASHBOARD_ENABLED = value;
        }

        const response = await POST(postRequest());

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toEqual({ error: 'Not found.' });
        expect(prisma.scheduledSession.findUnique).not.toHaveBeenCalled();
        expect(prisma.ticketEntitlement.create).not.toHaveBeenCalled();
        expect(prisma.user.upsert).not.toHaveBeenCalled();
        expect(prisma.webSession.create).not.toHaveBeenCalled();
    });

    it('only enables POST for the exact supervised-test value', async () => {
        process.env.E2E_DASHBOARD_ENABLED = '1';

        const response = await POST(postRequest());

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: 'Malformed request.' });
    });

    it('keeps GET indistinguishable from a missing route even during a test window', async () => {
        process.env.E2E_DASHBOARD_ENABLED = '1';

        const response = await GET();

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toEqual({ error: 'Not found.' });
    });
});
