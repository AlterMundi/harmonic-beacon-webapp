/**
 * Pure dramaturgical stage-composition policy.
 *
 * This module intentionally knows nothing about React, LiveKit, the DOM, the
 * viewport, or clocks. It turns a durable stage roster into stable semantic
 * placement and media-quality decisions. Active speech may change quality,
 * but never the social or DOM order of the scene.
 */

export const STAGE_MAX_PUBLISHERS = 6;
export const MAX_AUXILIARY_TILES = STAGE_MAX_PUBLISHERS - 1;

export interface StageVideoDimensions {
    width: number;
    height: number;
}

export const SPOTLIGHT_DIMENSIONS: StageVideoDimensions = { width: 1280, height: 720 };
export const AUXILIARY_DIMENSIONS: StageVideoDimensions = { width: 640, height: 360 };

export type StageConnectionQuality = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown';
export type StagePresence = 'connected' | 'reconnecting' | 'absent';
export type StageSceneKind = 'empty' | 'solo' | 'dyad' | 'circle' | 'chorus';
export type StageSceneRole = 'protagonist' | 'facilitator' | 'holder';
export type StageQualityPriority = 'high' | 'standard' | 'none';

export interface StagePublisher {
    /** Stable, event-scoped, non-PII identity. */
    identity: string;
    /** Actual display name, never the role or opaque identity. */
    label: string;
    isLocal: boolean;
    isFacilitator: boolean;
    isSpeaking: boolean;
    cameraOn: boolean;
    micOn: boolean;
    connectionQuality: StageConnectionQuality;
    /** Stable order assigned when the durable grant is first observed. */
    grantOrder: number;
    /** Optional explicit reconnect state; old callers degrade from quality. */
    presence?: StagePresence;
}

export interface StageScenePlacement<T> {
    member: T;
    role: StageSceneRole;
    order: number;
    quality: StageQualityPriority;
    presence: StagePresence;
}

export interface StageSceneComposition<T> {
    kind: StageSceneKind;
    placements: StageScenePlacement<T>[];
    overflow: T[];
}

export interface StageSceneOptions {
    /**
     * A shared, durable protagonist selection may be supplied in the future.
     * This policy does not create, persist, or expose a local pin control.
     */
    protagonistIdentity?: string | null;
    activeSpeakerIdentity?: string | null;
}

function byGrantOrder(a: StagePublisher, b: StagePublisher): number {
    return a.grantOrder - b.grantOrder || a.identity.localeCompare(b.identity);
}

function presenceOf(member: StagePublisher): StagePresence {
    if (member.presence) return member.presence;
    return member.connectionQuality === 'lost' ? 'reconnecting' : 'connected';
}

function sceneKindFor(count: number): StageSceneKind {
    if (count === 0) return 'empty';
    if (count === 1) return 'solo';
    if (count === 2) return 'dyad';
    if (count <= 4) return 'circle';
    return 'chorus';
}

function canRequestVideo(member: StagePublisher): boolean {
    return presenceOf(member) === 'connected' && member.cameraOn;
}

/**
 * Compose 0–6 unique grant holders into a stable scene.
 *
 * Duplicate identities collapse before the cap. The first canonical record
 * wins. The cap is then applied in stable grant order, so a seventh arrival
 * can never displace or cause decoding of an existing scene member.
 */
export function composeStageScene<T extends StagePublisher>(
    publishers: readonly T[],
    options: StageSceneOptions = {},
): StageSceneComposition<T> {
    const unique = new Map<string, T>();
    for (const publisher of publishers) {
        if (!unique.has(publisher.identity)) unique.set(publisher.identity, publisher);
    }

    const canonical = [...unique.values()].sort(byGrantOrder);
    const members = canonical.slice(0, STAGE_MAX_PUBLISHERS);
    const overflow = canonical.slice(STAGE_MAX_PUBLISHERS);
    const kind = sceneKindFor(members.length);
    if (members.length === 0) return { kind, placements: [], overflow };

    const selectedProtagonist =
        (options.protagonistIdentity
            ? members.find((member) => member.identity === options.protagonistIdentity)
            : undefined) ??
        [...members]
            .filter((member) => !member.isFacilitator)
            .sort((a, b) => -byGrantOrder(a, b))[0] ??
        members.find((member) => member.isFacilitator) ??
        members[0];

    const facilitator = members.find((member) => member.isFacilitator);
    const ordered = [
        selectedProtagonist,
        ...(facilitator && facilitator.identity !== selectedProtagonist.identity
            ? [facilitator]
            : []),
        ...members.filter(
            (member) =>
                member.identity !== selectedProtagonist.identity &&
                member.identity !== facilitator?.identity,
        ),
    ];

    const highQualityMember =
        (options.activeSpeakerIdentity
            ? ordered.find(
                (member) =>
                    member.identity === options.activeSpeakerIdentity && canRequestVideo(member),
            )
            : undefined) ??
        (canRequestVideo(selectedProtagonist) ? selectedProtagonist : undefined) ??
        ordered.find(canRequestVideo);

    return {
        kind,
        placements: ordered.map((member, order) => {
            const isSelectedProtagonist = member.identity === selectedProtagonist.identity;
            const isDyadFacilitator =
                kind === 'dyad' && member.identity === facilitator?.identity && !isSelectedProtagonist;
            const isSoloFacilitator = kind === 'solo' && member.isFacilitator;
            const role: StageSceneRole = isSoloFacilitator
                ? 'facilitator'
                : isSelectedProtagonist
                    ? 'protagonist'
                    : isDyadFacilitator
                        ? 'facilitator'
                        : 'holder';
            const presence = presenceOf(member);
            const quality: StageQualityPriority = !canRequestVideo(member)
                ? 'none'
                : member.identity === highQualityMember?.identity
                    ? 'high'
                    : 'standard';
            return { member, role, order, quality, presence };
        }),
        overflow,
    };
}

/** A stable, non-identifying visual tone derived from the opaque identity. */
export function stagePresenceTone(identity: string): 0 | 1 | 2 | 3 {
    let hash = 2166136261;
    for (let index = 0; index < identity.length; index += 1) {
        hash ^= identity.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (Math.abs(hash) % 4) as 0 | 1 | 2 | 3;
}
