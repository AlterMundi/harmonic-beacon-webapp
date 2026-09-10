import { JoinRequest, WrappedJoinRequest } from '@livekit/protocol';

/** Read public wire data, never SDK internals. SDK 2.17 defaults to /rtc/v1:
 * reconnect + participantSid are inside join_request, NOT legacy query fields.
 * Return only non-secret evidence; malformed/ambiguous protocols fail closed. */
export function signalingResume(url: string): { protocol: 'v0' | 'v1'; reconnect: boolean; sid: string } | null {
    try {
        const { pathname, searchParams: params } = new URL(url);
        if (pathname === '/rtc/v1') {
            if (params.has('reconnect') || params.has('sid') || params.getAll('join_request').length !== 1) return null;
            const encoded = params.get('join_request')!;
            const bytes = Buffer.from(encoded, 'base64');
            if (bytes.toString('base64') !== encoded) return null;
            const wrapped = WrappedJoinRequest.fromBinary(bytes);
            const join = JoinRequest.fromBinary(wrapped.joinRequest);
            return { protocol: 'v1', reconnect: join.reconnect, sid: join.participantSid ?? '' };
        }
        if (pathname !== '/rtc' || params.has('join_request') || params.getAll('reconnect').length > 1 || params.getAll('sid').length > 1) return null;
        return { protocol: 'v0', reconnect: params.get('reconnect') === '1', sid: params.get('sid') ?? '' };
    } catch {
        return null;
    }
}
