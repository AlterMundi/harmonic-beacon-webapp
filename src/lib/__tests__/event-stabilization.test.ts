import { describe, expect, it } from 'vitest';

import {
    assertStabilizationWindow,
    EVENT_CONTRACTS,
    stabilizationSnapshotDigest,
    type StabilizationSnapshot,
    validateStabilizationSnapshot,
} from '../event-stabilization';

function validSnapshot(): StabilizationSnapshot {
    return {
        sessions: EVENT_CONTRACTS.map((contract) => ({
            id: contract.id,
            title: contract.title,
            roomName: contract.roomName,
            language: contract.language,
            scheduledAt: contract.acceptedScheduledAt[0],
            startedAt: null,
            endedAt: null,
            status: contract.acceptedStatuses[0],
            isTest: contract.isTest,
            paidMode: true,
            attendeeCap: 150,
            maxPublishers: 6,
            facilitatorId: 'facilitator-id',
            counts: {
                tickets: { ISSUED: 0, BOUND: 0, REVOKED: 0, EXPIRED: 0 },
                unrevokedWebSessions: 0,
                participants: 0,
                raisedHands: 0,
                activeGrants: 0,
                reconcileNeeded: 0,
            },
        })),
    };
}

describe('event stabilization safety contract', () => {
    it('accepts the known pre-event rows and creates an order-independent digest', () => {
        const snapshot = validSnapshot();
        const reversed = { sessions: [...snapshot.sessions].reverse() };

        expect(() => validateStabilizationSnapshot(snapshot)).not.toThrow();
        expect(stabilizationSnapshotDigest(reversed)).toBe(stabilizationSnapshotDigest(snapshot));
    });

    it('changes the digest whenever relevant counts change', () => {
        const before = validSnapshot();
        const after = validSnapshot();
        after.sessions[2].counts.unrevokedWebSessions = 1;

        expect(stabilizationSnapshotDigest(after)).not.toBe(stabilizationSnapshotDigest(before));
    });

    it.each([
        ['title', 'unexpected'],
        ['roomName', 'wrong-room'],
        ['isTest', false],
        ['attendeeCap', 149],
        ['maxPublishers', 7],
    ] as const)('rejects a mismatch in %s', (field, value) => {
        const snapshot = validSnapshot();
        Object.assign(snapshot.sessions[2], { [field]: value });

        expect(() => validateStabilizationSnapshot(snapshot)).toThrow(/mismatch/);
    });

    it('rejects missing, ended, and unexpectedly rescheduled sessions', () => {
        const missing = validSnapshot();
        missing.sessions.pop();
        expect(() => validateStabilizationSnapshot(missing)).toThrow(/exactly 4/);

        const ended = validSnapshot();
        ended.sessions[0].status = 'ENDED';
        expect(() => validateStabilizationSnapshot(ended)).toThrow(/unsafe status/);

        const moved = validSnapshot();
        moved.sessions[0].scheduledAt = '2030-01-01T00:00:00.000Z';
        expect(() => validateStabilizationSnapshot(moved)).toThrow(/unexpected scheduledAt/);
    });

    it('refuses execution at and after the ten-minute doors boundary', () => {
        expect(() => assertStabilizationWindow(new Date('2026-08-01T14:19:59.999Z'))).not.toThrow();
        expect(() => assertStabilizationWindow(new Date('2026-08-01T14:20:00.000Z'))).toThrow(/Refusing/);
    });
});
