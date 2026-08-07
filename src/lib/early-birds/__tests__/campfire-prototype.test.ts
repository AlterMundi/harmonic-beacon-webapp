import { describe, expect, it } from 'vitest';

import { listenerCampfirePrototypeConfig } from '../campfire-prototype';

describe('Listener cosmic campfire prototype flag', () => {
    it('is absent by default and keeps the empty fixture', () => {
        expect(listenerCampfirePrototypeConfig({})).toEqual({
            enabled: false,
            fixture: 'empty',
        });
    });

    it('requires exact opt-in and accepts only deterministic fixtures', () => {
        expect(listenerCampfirePrototypeConfig({
            LISTENER_CAMPFIRE_PROTOTYPE: '1',
            LISTENER_CAMPFIRE_FIXTURE: 'middle',
        })).toEqual({ enabled: true, fixture: 'middle' });

        expect(listenerCampfirePrototypeConfig({
            LISTENER_CAMPFIRE_PROTOTYPE: 'true',
            LISTENER_CAMPFIRE_FIXTURE: 'live-presence',
        })).toEqual({ enabled: false, fixture: 'empty' });
    });
});
