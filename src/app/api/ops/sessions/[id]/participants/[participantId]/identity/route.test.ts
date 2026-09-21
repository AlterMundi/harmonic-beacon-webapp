import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), participant: vi.fn(), audit: vi.fn(), profile: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireStaff: mocks.auth }));
vi.mock('@/lib/db', () => ({ prisma: { sessionParticipant: { findFirst: mocks.participant }, auditLog: { create: mocks.audit } } }));
vi.mock('@/lib/account-admin-profile', () => ({ fetchAccountAdminProfile: mocks.profile }));
import { GET } from './route';
const invoke = () => GET(new Request('https://live.example/'), { params: Promise.resolve({ id: 'event', participantId: 'participant' }) });

describe('private participant identity', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.auth.mockResolvedValue([{ userId: 'admin' }, null]);
        mocks.participant.mockResolvedValue({ id: 'participant', displayName: 'Event alias', ticketEntitlement: { accountIssuer: 'https://account.example', accountId: 'subject' }, staffUser: null });
        mocks.audit.mockResolvedValue({});
        mocks.profile.mockResolvedValue({ preferredName: 'Preferred', realName: 'Private', email: 'synthetic@example.test', emailVerified: false });
    });
    it('requires literal ADMIN before any identity read', async () => {
        mocks.auth.mockResolvedValue([null, new Response(null, { status: 403 })]);
        expect((await invoke()).status).toBe(403);
        expect(mocks.auth).toHaveBeenCalledWith('ADMIN');
        expect(mocks.participant).not.toHaveBeenCalled();
        expect(mocks.profile).not.toHaveBeenCalled();
    });
    it('binds lookup to the exact participant and event and audits without PII', async () => {
        const response = await invoke();
        expect(mocks.participant.mock.calls[0][0].where).toEqual({ id: 'participant', scheduledSessionId: 'event' });
        expect(mocks.profile).toHaveBeenCalledWith('https://account.example', 'subject');
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(await response.json()).toMatchObject({ alias: 'Event alias', identity: { subject: 'subject', profile: { realName: 'Private', emailVerified: false } } });
        expect(mocks.audit.mock.calls[0][0].data).toEqual({ actorUserId: 'admin', actorRole: 'ADMIN', action: 'participant.identity.read', targetType: 'SESSION_PARTICIPANT', targetId: 'participant' });
    });
    it('does not guess the identity of historical anonymous participation', async () => {
        mocks.participant.mockResolvedValue({ id: 'participant', displayName: 'Event alias', ticketEntitlement: { accountIssuer: null, accountId: null }, staffUser: null });
        expect(await (await invoke()).json()).toMatchObject({ identity: null, status: 'unknown' });
        expect(mocks.profile).not.toHaveBeenCalled();
    });
    it('returns a generic failure rather than backend details', async () => {
        mocks.profile.mockRejectedValue(new Error('secret/internal/address'));
        const response = await invoke();
        expect(response.status).toBe(503);
        expect(await response.text()).not.toContain('secret');
    });
    it('does not fetch an identity when the participant belongs to another event', async () => {
        mocks.participant.mockResolvedValue(null);
        expect((await invoke()).status).toBe(404);
        expect(mocks.profile).not.toHaveBeenCalled();
    });
});
