import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), host: vi.fn(), update: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/account/auth', () => ({ currentAccountSession: mocks.session }));
vi.mock('@/lib/account/config', () => ({ isAccountHost: mocks.host }));
vi.mock('@/lib/db', () => ({ prisma: { beaconProfile: {
    updateMany: mocks.update, findUniqueOrThrow: mocks.read,
} } }));
import { POST } from './route';

function request(body: unknown) {
    return new Request('https://account.example/api/account/profile', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
}

describe('owner-only private profile editing', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.host.mockReturnValue(true);
        mocks.session.mockResolvedValue({ user: { id: 'owner' } });
        mocks.update.mockResolvedValue({ count: 1 });
        mocks.read.mockResolvedValue({ accountId: 'owner', displayName: 'Alias', realName: 'Private', revision: 2 });
    });
    it('requires an authenticated Account owner', async () => {
        mocks.session.mockResolvedValue(null);
        expect((await POST(request({}))).status).toBe(401);
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it('rejects incomplete profiles before writing', async () => {
        for (const realName of [undefined, '', '   ', '\u00a0']) {
            expect((await POST(request({ displayName: 'Alias', realName, revision: 1 }))).status).toBe(400);
        }
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it('ignores supplied account identity and updates only the session owner', async () => {
        const response = await POST(request({ accountId: 'another-account', displayName: ' Alias ', realName: ' Private ', revision: 1 }));
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(mocks.update).toHaveBeenCalledWith({
            where: { accountId: 'owner', revision: 1 },
            data: { displayName: 'Alias', realName: 'Private', revision: { increment: 1 } },
        });
    });
    it('preserves optimistic concurrency and does not return another revision after conflict', async () => {
        mocks.update.mockResolvedValue({ count: 0 });
        expect((await POST(request({ displayName: 'Alias', realName: 'Private', revision: 1 }))).status).toBe(409);
        expect(mocks.read).not.toHaveBeenCalled();
    });
});
