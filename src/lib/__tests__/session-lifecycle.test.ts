import { describe, expect, it } from 'vitest';

import {
    decideSessionTransition,
    SessionLifecycleError,
} from '../session-lifecycle';

const scheduledAt = new Date('2026-08-01T18:00:00Z');
const baseSession = {
    id: 'event-1',
    status: 'SCHEDULED' as const,
    scheduledAt,
    facilitatorId: 'facilitator-1',
};

function decide(overrides: Partial<Parameters<typeof decideSessionTransition>[0]> = {}) {
    return decideSessionTransition({
        session: baseSession,
        actor: { id: 'facilitator-1', role: 'FACILITATOR' },
        targetStatus: 'LIVE',
        now: scheduledAt,
        ...overrides,
    });
}

function expectLifecycleError(run: () => unknown, code: string) {
    try {
        run();
        throw new Error('Expected lifecycle decision to fail');
    } catch (error) {
        expect(error).toBeInstanceOf(SessionLifecycleError);
        expect((error as SessionLifecycleError).code).toBe(code);
    }
}

describe('decideSessionTransition', () => {
    it.each([
        ['SCHEDULED', 'LIVE'],
        ['LIVE', 'ENDED'],
        ['SCHEDULED', 'CANCELLED'],
        ['LIVE', 'CANCELLED'],
    ] as const)('allows %s → %s', (status, targetStatus) => {
        const actor: Parameters<typeof decideSessionTransition>[0]['actor'] = targetStatus === 'CANCELLED'
            ? { id: 'admin-1', role: 'ADMIN' }
            : { id: 'facilitator-1', role: 'FACILITATOR' };
        expect(decide({
            session: { ...baseSession, status },
            targetStatus,
            actor,
            reason: targetStatus === 'CANCELLED' ? 'Weather emergency' : undefined,
        }).kind).toBe('transition');
    });

    it.each([
        ['SCHEDULED', 'ENDED'],
        ['ENDED', 'LIVE'],
        ['ENDED', 'CANCELLED'],
        ['CANCELLED', 'LIVE'],
        ['CANCELLED', 'ENDED'],
    ] as const)('rejects %s → %s', (status, targetStatus) => {
        expectLifecycleError(() => decide({
            session: { ...baseSession, status },
            targetStatus,
            actor: { id: 'admin-1', role: 'ADMIN' },
            reason: 'Operator note',
        }), 'invalid_transition');
    });

    it.each(['LIVE', 'ENDED', 'CANCELLED'] as const)(
        'makes a repeated transition to %s idempotent',
        (status) => {
            expect(decide({
                session: { ...baseSession, status },
                targetStatus: status,
                actor: status === 'CANCELLED'
                    ? { id: 'admin-1', role: 'ADMIN' }
                    : { id: 'facilitator-1', role: 'FACILITATOR' },
            })).toEqual({ kind: 'idempotent' });
        },
    );

    it('scopes facilitators to their assigned event', () => {
        expectLifecycleError(() => decide({
            actor: { id: 'another-facilitator', role: 'FACILITATOR' },
        }), 'forbidden');
    });

    it.each(['OPERATOR', 'ADMIN', 'FACILITATOR_OP'] as const)('allows %s to operate any event', (role) => {
        expect(decide({ actor: { id: 'staff-1', role } }).kind).toBe('transition');
    });

    it('enforces the open window at both boundaries', () => {
        const earliest = new Date(scheduledAt.getTime() - 10 * 60 * 1000);
        const latest = new Date(scheduledAt.getTime() + 60 * 60 * 1000);
        expect(decide({ now: earliest }).kind).toBe('transition');
        expect(decide({ now: latest }).kind).toBe('transition');
        expectLifecycleError(
            () => decide({ now: new Date(earliest.getTime() - 1) }),
            'outside_open_window',
        );
        expectLifecycleError(
            () => decide({ now: new Date(latest.getTime() + 1) }),
            'outside_open_window',
        );
    });

    it('permits a reasoned admin override outside the open window', () => {
        expect(decide({
            actor: { id: 'admin-1', role: 'ADMIN' },
            now: new Date('2026-08-01T12:00:00Z'),
            reason: 'Approved rehearsal',
        })).toMatchObject({ kind: 'transition', adminOverride: true });
    });

    it('gives FACILITATOR_OP the same reasoned lifecycle override without treating other events as assigned', () => {
        expect(decide({
            actor: { id: 'facilitator-op-1', role: 'FACILITATOR_OP' },
            now: new Date('2026-08-01T12:00:00Z'),
            reason: 'Approved rehearsal',
        })).toMatchObject({ kind: 'transition', adminOverride: true });
        expect(decide({
            session: { ...baseSession, status: 'LIVE' },
            actor: { id: 'facilitator-op-1', role: 'FACILITATOR_OP' },
            targetStatus: 'CANCELLED',
            reason: 'Safety cancellation',
        }).kind).toBe('transition');
    });

    it('requires a reason for exceptional transitions', () => {
        expectLifecycleError(() => decide({
            actor: { id: 'admin-1', role: 'ADMIN' },
            now: new Date('2026-08-01T12:00:00Z'),
        }), 'reason_required');
        expectLifecycleError(() => decide({
            session: { ...baseSession, status: 'LIVE' },
            actor: { id: 'admin-1', role: 'ADMIN' },
            targetStatus: 'CANCELLED',
        }), 'reason_required');
    });

    it('reserves cancellation for administrators', () => {
        expectLifecycleError(() => decide({
            targetStatus: 'CANCELLED',
            reason: 'Cannot proceed',
        }), 'forbidden');
    });
});
