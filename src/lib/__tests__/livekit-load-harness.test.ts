import { describe, expect, it } from 'vitest';

import {
    assertSafeTarget,
    buildPlan,
    manifestContainsSecret,
    parseLoadTestOutput,
    remoteConfirmation,
    roomNames,
    validateProfile,
} from '../../../scripts/lib/livekit-load-harness.mjs';

const profile = {
    eventLanguage: 'es',
    attendees: 150,
    stagePublishers: 6,
    beaconPublishers: 1,
    rampPerSecond: 10,
    rampDurationSeconds: 60,
    soakDurationSeconds: 1200,
    reconnectDurationSeconds: 60,
    reconnectWaves: 2,
    reconnectMode: 'staggered',
    interWaveSeconds: 10,
    maxDroppedPercent: 0.1,
};

describe('LiveKit load harness safety', () => {
    it('builds two synthetic connections per attendee and caps the stage at six publishers', () => {
        const plan = buildPlan({
            profileName: 'rehearsal-es',
            profile,
            runId: 'event-weekend',
            url: 'ws://localhost:7880',
        });
        expect(plan.rooms).toEqual({
            stage: 'hb-load-event-weekend-es-stage',
            beacon: 'hb-load-event-weekend-es-beacon',
        });
        expect(plan.phases.map((phase) => phase.name)).toEqual([
            'ramp', 'soak', 'reconnect-1', 'reconnect-2',
        ]);
        expect(plan.phases[0].stage.requestedConnections).toBe(156);
        expect(plan.phases[0].beacon.requestedConnections).toBe(151);
        expect(plan.phases[0].stage.args).toContain('6');
        expect(plan.phases[0].beacon.args).toContain('1');
        expect(plan.phases[0].stage.args).toContain('hbload-event-weekend-stage');
        expect(plan.phases[2].stage.args).toContain('hbload-event-weekend-stage');
    });

    it('rejects a seventh stage publisher before starting traffic', () => {
        expect(() => validateProfile({ ...profile, stagePublishers: 7 }))
            .toThrow(/cap of six/);
    });

    it('refuses remote targets unless the operator confirms both generated test rooms exactly', () => {
        const rooms = roomNames('remote-check');
        expect(() => assertSafeTarget({
            url: 'wss://live.example.test', rooms, allowRemote: false, confirmation: '',
        })).toThrow(/require --allow-remote/);
        expect(() => assertSafeTarget({
            url: 'wss://live.example.test', rooms, allowRemote: true, confirmation: 'yes',
        })).toThrow(/confirmation mismatch/);
        expect(assertSafeTarget({
            url: 'wss://live.example.test',
            rooms,
            allowRemote: true,
            confirmation: remoteConfirmation(rooms),
        }).target).toBe('remote-explicit');
    });

    it('never accepts real event room names', () => {
        expect(() => assertSafeTarget({
            url: 'ws://localhost:7880',
            rooms: { stage: 'real-spanish-event', beacon: 'beacon' },
            allowRemote: false,
            confirmation: '',
        })).toThrow(/unsafe room name/);
    });
});

describe('LiveKit load harness evidence', () => {
    it('parses the official CLI total summary without retaining participant rows', () => {
        const output = 'Summary | Tester | Tracks | Bitrate | Latency | Total Dropped\n' +
            '        | Total | 5000/5000 | 678.7mbps | 79.923769ms | 0 (0%)\n';
        expect(parseLoadTestOutput(output)).toEqual({
            parsed: true,
            tracksReceived: 5000,
            tracksExpected: 5000,
            latencyMs: 79.923769,
            dropped: 0,
            droppedPercent: 0,
            errorCount: null,
        });
    });

    it('parses the current Unicode CLI table and its error count', () => {
        const output = '│ Total  │ 8/8 │ 6.3mbps (1.6mbps avg) │ 0 (0%) │ 0 │';
        expect(parseLoadTestOutput(output)).toEqual({
            parsed: true,
            tracksReceived: 8,
            tracksExpected: 8,
            latencyMs: null,
            dropped: 0,
            droppedPercent: 0,
            errorCount: 0,
        });
    });

    it('fails closed when the CLI output has no machine-recognizable summary', () => {
        expect(parseLoadTestOutput('load tester exited unexpectedly').parsed).toBe(false);
    });

    it('detects credentials anywhere in a candidate manifest', () => {
        expect(manifestContainsSecret({ nested: ['safe', 'secret-value'] }, ['key', 'secret-value']))
            .toBe(true);
        expect(manifestContainsSecret({ nested: ['safe'] }, ['key', 'secret-value']))
            .toBe(false);
    });
});
