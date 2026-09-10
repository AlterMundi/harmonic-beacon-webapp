import { describe, expect, it } from 'vitest';
import { JoinRequest, WrappedJoinRequest } from '@livekit/protocol';
import { signalingResume } from '../../../e2e/helpers/signaling-resume';

function v1(reconnect: boolean, participantSid?: string) {
    const wrapped = new WrappedJoinRequest({ joinRequest: new JoinRequest({ reconnect, participantSid }).toBinary() });
    return `ws://localhost:7880/rtc/v1?access_token=not-for-evidence&join_request=${encodeURIComponent(Buffer.from(wrapped.toBinary()).toString('base64'))}`;
}
describe('public SDK signaling wire evidence is strict across versions', () => {
    it('decodes real protobuf reconnect and SID without returning token-bearing URLs', () => {
        expect(signalingResume(v1(true, 'PA_stage'))).toEqual({ protocol: 'v1', reconnect: true, sid: 'PA_stage' });
        expect(signalingResume('ws://localhost:7880/rtc?reconnect=1&sid=PA_stage&access_token=secret')).toEqual({ protocol: 'v0', reconnect: true, sid: 'PA_stage' });
    });
    it('keeps fresh joins and absent SIDs distinguishable from qualified resume', () => {
        expect(signalingResume(v1(false, 'PA_stage'))?.reconnect).toBe(false);
        expect(signalingResume(v1(true))?.sid).toBe('');
        expect(signalingResume('ws://localhost:7880/rtc?reconnect=true&sid=PA_stage')?.reconnect).toBe(false);
    });
    it.each([
        'ws://localhost:7880/rtc/v1?join_request=garbage',
        'ws://localhost:7880/rtc/v1?reconnect=1&sid=PA_stage',
        'ws://localhost:7880/rtc/v1?join_request=AA==&join_request=AA==',
        'ws://localhost:7880/rtc?join_request=AA==&reconnect=1&sid=PA_stage',
        'ws://localhost:7880/rtc?reconnect=1&reconnect=0&sid=PA_stage',
        'ws://localhost:7880/rtc?reconnect=1&sid=PA_stage&sid=PA_other',
        'ws://localhost:7880/other?reconnect=1&sid=PA_stage',
        'not-a-url',
    ])('fails closed for malformed/ambiguous wire data (%s)', url => {
        expect(signalingResume(url)).toBeNull();
    });
});
