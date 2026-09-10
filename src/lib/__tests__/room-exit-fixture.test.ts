import { describe, expect, it, vi } from 'vitest';
import type { Frame, Page } from '@playwright/test';
import { leaveConnectedRoom } from '../../../e2e/helpers/audio-readiness';

// Fast label/ownership seam; real Page/Frame DOM coverage is in
// e2e/helpers/__tests__/room-exit.spec.ts. No browser needed for unit collection.
vi.mock('@playwright/test', () => ({
    expect: Object.assign(
        (locator: { count: () => number | Promise<number> }) => ({
            toHaveCount: async (count: number) => expect(await locator.count()).toBe(count),
        }),
        { poll: (read: () => Promise<number | boolean>) => ({
            toBe: async (value: boolean) => expect(await read()).toBe(value),
            toBeGreaterThan: async (value: number) => expect(await read()).toBeGreaterThan(value),
        }) },
    ),
}));

const labels = [
    { locale: 'current en', leave: 'Leave session', heading: 'Leave the room?', confirm: 'Leave the room' },
    { locale: 'current es', leave: 'Salir de la sesión', heading: '¿Salir de la sala?', confirm: 'Salir de la sala' },
    { locale: 'legacy en', leave: 'Leave session', heading: 'Leave session', confirm: 'Yes, leave the session' },
    { locale: 'legacy es', leave: 'Salir de la sesión', heading: 'Salir de la sesión', confirm: 'Sí, salir de la sesión' },
];
type Owner = 'page' | 'frame' | 'parent' | 'both' | 'none';

function fixture(copy: typeof labels[number], owner: Owner, disconnect = true, leaveVisible = true) {
    let connected = true;
    let prompted = false;
    let confirmations = 0;
    const framed = owner !== 'page';
    function roleLocator(location: 'local' | 'parent', role: string, { name }: { name: RegExp }) {
        const present = () => prompted && confirmations === 0 && name.test(copy.heading) &&
            (owner === 'both' || (location === 'local' ? owner === 'page' || owner === 'frame' : owner === 'parent'));
        if (role === 'alertdialog') return {
            count: async () => present() ? 1 : 0,
            getByRole: (_: string, button: { name: RegExp }) => ({
                click: async () => {
                    if (!present() || !button.name.test(copy.confirm)) throw new Error('confirmation not found in selected document');
                    confirmations++;
                    if (disconnect) connected = false;
                },
            }),
        };
        return {
            isVisible: async () => leaveVisible && connected && name.test(copy.leave),
            click: async () => { prompted = true; },
        };
    }
    const host = {
        mainFrame: () => ({}),
        getByRole: vi.fn((role: string, options: { name: RegExp }) => roleLocator('parent', role, options)),
    };
    const surface = {
        ...(framed ? { page: () => host } : {}),
        getByRole: vi.fn((role: string, options: { name: RegExp }) => roleLocator('local', role, options)),
        getByTestId: vi.fn(() => ({ count: () => connected ? 1 : 0 })),
    };
    return { surface: surface as unknown as Page | Frame, state: () => ({ connected, prompted, confirmations }) };
}

describe('confirmed connected-room exit helper', () => {
    for (const owner of ['page', 'frame', 'parent'] as const) {
        it.each(labels)(`confirms $locale in ${owner} and requires disconnection`, async (copy) => {
            const { surface, state } = fixture(copy, owner);
            await leaveConnectedRoom(surface);
            expect(state()).toEqual({ connected: false, prompted: true, confirmations: 1 });
            expect(surface.getByTestId).toHaveBeenCalledWith('connection-state');
        });
        it(`does not accept ${owner} confirmation without actual disconnection`, async () => {
            const { surface, state } = fixture(labels[0], owner, false);
            await expect(leaveConnectedRoom(surface)).rejects.toThrow();
            expect(state().confirmations).toBe(1);
            expect(surface.getByTestId).toHaveBeenCalledWith('connection-state');
        });
    }
    for (const owner of ['both', 'none'] as const) {
        it(`rejects ${owner} confirmation owners without clicking either`, async () => {
            const { surface, state } = fixture(labels[0], owner);
            await expect(leaveConnectedRoom(surface)).rejects.toThrow();
            expect(state()).toEqual({ connected: true, prompted: true, confirmations: 0 });
        });
    }
    it('does not silently succeed with a connected room and no exit control', async () => {
        const { surface, state } = fixture(labels[0], 'frame', true, false);
        await expect(leaveConnectedRoom(surface)).rejects.toThrow();
        expect(state().connected).toBe(true);
    });
});
