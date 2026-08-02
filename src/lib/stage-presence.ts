export type EffectiveStageState =
    | 'AUDIENCE'
    | 'INVITED'
    | 'RECONNECTING'
    | 'ON_STAGE'
    | 'UNKNOWN';

export function effectiveStageState(input: {
    hasActiveGrant: boolean;
    connected: boolean | null;
    publishedTrackCount: number;
}): EffectiveStageState {
    // Publication is deliberately stricter than a durable grant: a newly
    // connected attendee has not accepted the invitation until the browser
    // publishes at least one current track. Muted tracks still count because
    // they prove acceptance while accurately rendering media as muted.
    if (!input.hasActiveGrant) return 'AUDIENCE';
    if (input.connected === null) return 'UNKNOWN';
    if (!input.connected) return 'RECONNECTING';
    if (input.publishedTrackCount === 0) return 'INVITED';
    return 'ON_STAGE';
}
