export const LISTENER_CAMPFIRE_FIXTURES = ['empty', 'near', 'middle', 'far'] as const;

export type ListenerCampfireFixture = typeof LISTENER_CAMPFIRE_FIXTURES[number];

export type ListenerCampfirePrototypeConfig = {
    enabled: boolean;
    fixture: ListenerCampfireFixture;
};

export function listenerCampfirePrototypeConfig(
    env: Readonly<Record<string, string | undefined>> = process.env,
): ListenerCampfirePrototypeConfig {
    const requestedFixture = env.LISTENER_CAMPFIRE_FIXTURE;
    const fixture = LISTENER_CAMPFIRE_FIXTURES.find((candidate) => candidate === requestedFixture)
        ?? 'empty';

    return {
        // Exact opt-in. The isolated preview and production remain on the
        // established blank Listener unless an operator deliberately enables
        // this presentation-only prototype.
        enabled: env.LISTENER_CAMPFIRE_PROTOTYPE === '1',
        fixture,
    };
}
