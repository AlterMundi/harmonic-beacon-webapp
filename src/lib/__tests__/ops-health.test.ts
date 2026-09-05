import { describe, expect, it } from 'vitest';

import {
    collectOperatorHealth,
    type OperatorHealthDeps,
    type WatchedSession,
} from '../ops-health';

const LIVE_SESSION: WatchedSession = {
    id: 'session-1',
    title: 'Saturday EN session',
    status: 'LIVE',
    roomName: 'stage-room',
    maxPublishers: 6,
};

const SCHEDULED_SESSION: WatchedSession = { ...LIVE_SESSION, status: 'SCHEDULED' };

/** A fully healthy production: live session, room up, bot publishing, 6/6 grants. */
function healthyDeps(overrides: Partial<OperatorHealthDeps> = {}): OperatorHealthDeps {
    return {
        checkDatabase: async () => [{ '?column?': 1 }],
        getWatchedSession: async () => LIVE_SESSION,
        countActivePublishGrants: async () => 6,
        getGrantEffectBacklog: async () => ({
            pending: 0,
            fences: 0,
            oldestCreatedAt: null,
            maxAttempts: 0,
            lastErrorCode: null,
        }),
        listRooms: async () => [
            { name: 'stage-room', numParticipants: 42 },
            { name: 'beacon', numParticipants: 1 },
        ],
        listParticipants: async () => [{ identity: 'playlist-bot', hasPublishedAudio: true }],
        fetchTapestryHealth: async () => ({ ok: true }),
        tapestryUrl: 'http://tapestry:3100',
        bedRoomName: 'beacon',
        bedPublisherIdentity: 'playlist-bot',
        timeoutMs: 100,
        ...overrides,
    };
}

describe('collectOperatorHealth', () => {
    it('is green when every subsystem answers, including five grants plus Julián (6/6)', async () => {
        const report = await collectOperatorHealth(healthyDeps());

        expect(report.status).toBe('green');
        expect(report.session).toEqual({
            id: 'session-1',
            title: 'Saturday EN session',
            status: 'LIVE',
        });
        for (const check of Object.values(report.checks)) {
            expect(check.status).toBe('green');
            expect(check.error).toBeUndefined();
        }
        expect(report.checks.publisherGrants.detail).toContain('6/6');
    });

    it('raises the red invariant alarm when publish grants exceed the six-publisher cap', async () => {
        const report = await collectOperatorHealth(
            healthyDeps({ countActivePublishGrants: async () => 7 }),
        );

        expect(report.status).toBe('red');
        expect(report.checks.publisherGrants.status).toBe('red');
        expect(report.checks.publisherGrants.detail).toContain('INVARIANT VIOLATED');
        expect(report.checks.publisherGrants.detail).toContain('7');
        // The other subsystems are fine and must say so.
        expect(report.checks.postgres.status).toBe('green');
        expect(report.checks.livekit.status).toBe('green');
    });

    it('reports persistent grant retries as degraded without coupling worker liveness', async () => {
        const report = await collectOperatorHealth(healthyDeps({
            getGrantEffectBacklog: async () => ({
                pending: 2,
                fences: 1,
                oldestCreatedAt: new Date(Date.now() - 120_000),
                maxAttempts: 4,
                lastErrorCode: 'LIVEKIT_EFFECT_INCOMPLETE',
            }),
        }));

        expect(report.status).toBe('red');
        expect(report.checks.grantDelivery).toMatchObject({ status: 'red' });
        expect(report.checks.grantDelivery.detail).toContain('max attempts 4');
        expect(report.checks.grantDelivery.detail).toContain('LIVEKIT_EFFECT_INCOMPLETE');
    });

    it('turns red and names PostgreSQL when the database is lost, without leaking credentials', async () => {
        const report = await collectOperatorHealth(
            healthyDeps({
                checkDatabase: async () => {
                    throw new Error(
                        'password authentication failed: postgres://beacon:hunter2@db.internal:5432/beacon',
                    );
                },
                getWatchedSession: async () => {
                    throw new Error('connection terminated: postgres://beacon:hunter2@db.internal:5432/beacon');
                },
            }),
        );

        expect(report.status).toBe('red');
        expect(report.checks.postgres.status).toBe('red');
        // Database-backed checks are unverifiable, not silently green.
        expect(report.checks.stageRoom.status).toBe('red');
        expect(report.checks.publisherGrants.status).toBe('red');
        // Independent subsystems still report their own truth.
        expect(report.checks.livekit.status).toBe('green');
        expect(report.checks.tapestry.status).toBe('green');

        const serialized = JSON.stringify(report);
        expect(serialized).not.toContain('hunter2');
        // The redactor keeps scheme, host and user — diagnostically useful,
        // not secret. The password is the part that must never survive.
        expect(serialized).not.toContain('beacon:hunter2');
    });

    it('turns red and names LiveKit when the API is lost', async () => {
        const report = await collectOperatorHealth(
            healthyDeps({
                listRooms: async () => {
                    throw new Error('connect ECONNREFUSED 10.0.0.8:7880');
                },
            }),
        );

        expect(report.status).toBe('red');
        expect(report.checks.livekit.status).toBe('red');
        // Stage room and bed publisher cannot be verified without the API.
        expect(report.checks.stageRoom.status).toBe('red');
        expect(report.checks.bedPublisher.status).toBe('red');
        // Database-backed checks are unaffected.
        expect(report.checks.postgres.status).toBe('green');
        expect(report.checks.publisherGrants.status).toBe('green');

        expect(JSON.stringify(report)).toContain('ECONNREFUSED');
    });

    it('turns red when the bed publisher is absent from the bed room', async () => {
        const report = await collectOperatorHealth(
            healthyDeps({ listParticipants: async () => [] }),
        );

        expect(report.status).toBe('red');
        expect(report.checks.bedPublisher.status).toBe('red');
        expect(report.checks.bedPublisher.detail).toContain('playlist-bot');
        expect(report.checks.bedPublisher.detail).toContain('beacon');
    });

    it('turns red when the bot is present but publishes no audio track', async () => {
        const report = await collectOperatorHealth(
            healthyDeps({
                listParticipants: async () => [
                    { identity: 'playlist-bot', hasPublishedAudio: false },
                ],
            }),
        );

        expect(report.checks.bedPublisher.status).toBe('red');
        expect(report.checks.bedPublisher.detail).toContain('no published audio');
    });

    it('turns red when the bed room does not exist at all', async () => {
        const report = await collectOperatorHealth(
            healthyDeps({
                listParticipants: async () => {
                    throw new Error('room does not exist');
                },
            }),
        );

        expect(report.checks.bedPublisher.status).toBe('red');
    });

    it('is only yellow when the tapestry is lost — the event can run without it', async () => {
        const report = await collectOperatorHealth(
            healthyDeps({
                fetchTapestryHealth: async () => {
                    throw new Error('fetch failed');
                },
            }),
        );

        expect(report.status).toBe('yellow');
        expect(report.checks.tapestry.status).toBe('yellow');
        expect(report.checks.tapestry.detail).toContain('cuttable');
        expect(report.checks.postgres.status).toBe('green');
    });

    it('is yellow when the tapestry answers with a non-OK status', async () => {
        const report = await collectOperatorHealth(
            healthyDeps({ fetchTapestryHealth: async () => ({ ok: false }) }),
        );

        expect(report.status).toBe('yellow');
        expect(report.checks.tapestry.status).toBe('yellow');
    });

    it('is red when a LIVE session has no stage room in LiveKit', async () => {
        const report = await collectOperatorHealth(
            healthyDeps({ listRooms: async () => [{ name: 'beacon', numParticipants: 1 }] }),
        );

        expect(report.checks.stageRoom.status).toBe('red');
        expect(report.checks.stageRoom.detail).toContain('attendees cannot join');
    });

    it('stays green when a SCHEDULED session has no stage room yet', async () => {
        const report = await collectOperatorHealth(
            healthyDeps({
                getWatchedSession: async () => SCHEDULED_SESSION,
                listRooms: async () => [{ name: 'beacon', numParticipants: 1 }],
            }),
        );

        expect(report.status).toBe('green');
        expect(report.checks.stageRoom.status).toBe('green');
        expect(report.checks.stageRoom.detail).toContain('first join');
    });

    it('reports green with a null session when nothing is live or scheduled', async () => {
        const report = await collectOperatorHealth(
            healthyDeps({ getWatchedSession: async () => null }),
        );

        expect(report.status).toBe('green');
        expect(report.session).toBeNull();
        expect(report.checks.stageRoom.status).toBe('green');
        expect(report.checks.publisherGrants.status).toBe('green');
    });

    it('fails a hanging probe as a timeout within the configured bound', async () => {
        const started = Date.now();
        const report = await collectOperatorHealth(
            healthyDeps({
                timeoutMs: 50,
                checkDatabase: () => new Promise(() => {}),
                getWatchedSession: () => new Promise(() => {}),
            }),
        );

        expect(report.checks.postgres.status).toBe('red');
        expect(report.checks.postgres.error).toContain('timed out');
        // A hung database must not hang the report.
        expect(Date.now() - started).toBeLessThan(5000);
    });

    it('never exposes raw secrets anywhere in the serialized report', async () => {
        const report = await collectOperatorHealth(
            healthyDeps({
                checkDatabase: async () => {
                    throw new Error('auth failed postgresql://beacon:hunter2@db.internal:5432/beacon');
                },
                getWatchedSession: async () => {
                    throw new Error('auth failed postgresql://beacon:hunter2@db.internal:5432/beacon');
                },
                listRooms: async () => {
                    throw new Error('unauthorized https://live.internal/twirp?token=livekit-secret-value');
                },
                fetchTapestryHealth: async () => {
                    throw new Error('fetch failed http://tapestry:3100/health?password=tapestry-secret');
                },
            }),
        );

        const serialized = JSON.stringify(report);
        expect(serialized).not.toContain('hunter2');
        expect(serialized).not.toContain('livekit-secret-value');
        expect(serialized).not.toContain('tapestry-secret');
        expect(serialized).not.toContain('beacon:hunter2');
    });
});
