import { createHash } from 'node:crypto';

import type {
    ScheduledSessionStatus,
    SessionLanguage,
    TicketEntitlementState,
} from '@prisma/client';

export const EVENT_STABILIZATION_DEADLINE = new Date('2026-08-02T16:50:00.000Z');

export type EventContract = {
    id: string;
    key: 'real-es' | 'real-en' | 'test-es' | 'test-en';
    title: string;
    roomName: string;
    language: SessionLanguage;
    isTest: boolean;
    paidMode: boolean;
    desiredStatus: Extract<ScheduledSessionStatus, 'SCHEDULED' | 'CANCELLED'>;
    scheduledAt: string;
    acceptedScheduledAt: readonly string[];
    acceptedStatuses: readonly ScheduledSessionStatus[];
};

export const EVENT_CONTRACTS: readonly EventContract[] = [
    {
        id: '10000000-0000-4000-8000-000000000001',
        key: 'real-es',
        title: 'Harmonic Beacon — Encuentro abierto ES/EN',
        roomName: 'weekend-session-1',
        language: 'SPANISH',
        isTest: false,
        scheduledAt: '2026-08-02T17:00:00.000Z',
        acceptedScheduledAt: [
            '2026-08-01T14:30:00.000Z',
            '2026-08-02T17:00:00.000Z',
            '2026-08-08T14:30:00.000Z',
        ],
        acceptedStatuses: ['SCHEDULED', 'LIVE'],
        // Historical weekend rows are constrained to paid_mode=true. Free
        // admission is represented by the COMP promotion entitlement itself.
        paidMode: true,
        desiredStatus: 'SCHEDULED',
    },
    {
        id: '10000000-0000-4000-8000-000000000002',
        key: 'real-en',
        title: 'Harmonic Beacon Session — English',
        roomName: 'weekend-session-2',
        language: 'ENGLISH',
        isTest: false,
        scheduledAt: '2026-08-08T20:00:00.000Z',
        acceptedScheduledAt: [
            '2026-08-01T18:30:00.000Z',
            '2026-08-01T20:00:00.000Z',
            '2026-08-08T20:00:00.000Z',
        ],
        acceptedStatuses: ['CANCELLED'],
        paidMode: true,
        desiredStatus: 'CANCELLED',
    },
    {
        id: '10000000-0000-4000-8000-000000000101',
        key: 'test-es',
        title: 'Harmonic Projection — Sesión en Español (test)',
        roomName: 'weekend-test-spanish',
        language: 'SPANISH',
        isTest: true,
        scheduledAt: '2026-08-08T14:30:00.000Z',
        acceptedScheduledAt: [
            '2026-08-01T14:30:00.000Z',
            '2026-08-08T14:30:00.000Z',
        ],
        acceptedStatuses: ['SCHEDULED', 'LIVE', 'CANCELLED'],
        paidMode: true,
        desiredStatus: 'CANCELLED',
    },
    {
        id: '10000000-0000-4000-8000-000000000102',
        key: 'test-en',
        title: 'Harmonic Projection — English Session (test)',
        roomName: 'weekend-test-english',
        language: 'ENGLISH',
        isTest: true,
        scheduledAt: '2026-08-08T20:00:00.000Z',
        acceptedScheduledAt: [
            '2026-08-01T18:30:00.000Z',
            '2026-08-01T20:00:00.000Z',
            '2026-08-08T20:00:00.000Z',
        ],
        acceptedStatuses: ['SCHEDULED', 'LIVE', 'CANCELLED'],
        paidMode: true,
        desiredStatus: 'CANCELLED',
    },
] as const;

export type StabilizationSessionSnapshot = {
    id: string;
    title: string;
    roomName: string;
    language: SessionLanguage;
    scheduledAt: string;
    startedAt: string | null;
    endedAt: string | null;
    status: ScheduledSessionStatus;
    isTest: boolean;
    paidMode: boolean;
    attendeeCap: number;
    maxPublishers: number;
    facilitatorId: string;
    counts: {
        tickets: Record<TicketEntitlementState, number>;
        unrevokedWebSessions: number;
        participants: number;
        raisedHands: number;
        activeGrants: number;
        reconcileNeeded: number;
    };
};

export type StabilizationSnapshot = {
    sessions: StabilizationSessionSnapshot[];
};

export function validateStabilizationSnapshot(snapshot: StabilizationSnapshot): void {
    if (snapshot.sessions.length !== EVENT_CONTRACTS.length) {
        throw new Error(
            `Expected exactly ${EVENT_CONTRACTS.length} event rows; found ${snapshot.sessions.length}`,
        );
    }

    for (const contract of EVENT_CONTRACTS) {
        const session = snapshot.sessions.find((candidate) => candidate.id === contract.id);
        if (!session) throw new Error(`Missing required event ${contract.key} (${contract.id})`);

        const assertions: Array<[string, unknown, unknown]> = [
            ['title', session.title, contract.title],
            ['roomName', session.roomName, contract.roomName],
            ['language', session.language, contract.language],
            ['isTest', session.isTest, contract.isTest],
            ['paidMode', session.paidMode, contract.paidMode],
            ['attendeeCap', session.attendeeCap, 150],
            ['maxPublishers', session.maxPublishers, 6],
        ];
        for (const [field, actual, expected] of assertions) {
            if (actual !== expected) {
                throw new Error(
                    `${contract.key} contract mismatch for ${field}: expected ${String(expected)}, found ${String(actual)}`,
                );
            }
        }
        if (!contract.acceptedScheduledAt.includes(session.scheduledAt)) {
            throw new Error(
                `${contract.key} has unexpected scheduledAt ${session.scheduledAt}`,
            );
        }
        if (!contract.acceptedStatuses.includes(session.status)) {
            throw new Error(`${contract.key} has unsafe status ${session.status}`);
        }
    }
}

export function canonicalStabilizationSnapshot(snapshot: StabilizationSnapshot): StabilizationSnapshot {
    return {
        sessions: EVENT_CONTRACTS.map((contract) => {
            const session = snapshot.sessions.find((candidate) => candidate.id === contract.id);
            if (!session) throw new Error(`Missing required event ${contract.key} (${contract.id})`);
            return session;
        }),
    };
}

export function stabilizationSnapshotDigest(snapshot: StabilizationSnapshot): string {
    validateStabilizationSnapshot(snapshot);
    return createHash('sha256')
        .update(JSON.stringify(canonicalStabilizationSnapshot(snapshot)))
        .digest('hex');
}

export function assertStabilizationWindow(now: Date): void {
    if (now.getTime() >= EVENT_STABILIZATION_DEADLINE.getTime()) {
        throw new Error(
            `Refusing event stabilization at or after ${EVENT_STABILIZATION_DEADLINE.toISOString()}`,
        );
    }
}

export function desiredSessionState(contract: EventContract, now: Date) {
    return contract.desiredStatus === 'CANCELLED'
        ? {
            status: 'CANCELLED' as const,
            scheduledAt: new Date(contract.scheduledAt),
            title: contract.title,
            paidMode: contract.paidMode,
            endedAt: now,
        }
        : {
            status: 'SCHEDULED' as const,
            scheduledAt: new Date(contract.scheduledAt),
            title: contract.title,
            paidMode: contract.paidMode,
            startedAt: null,
            endedAt: null,
        };
}
