import { expect, type Frame, type Locator, type Page } from '@playwright/test';

/** Confirm exactly once in the document that actually owns the dialog:
 * legacy rooms render locally; #70 can delegate to the outer Page. Never
 * choose one of two prompts or treat a missing prompt as successful teardown.
 * Exact current/legacy EN/ES labels also support before-fix behavioral runs. */
export async function leaveConnectedRoom(
    surface: Frame | Page,
): Promise<void> {
    const state = surface.getByTestId('connection-state');
    let dialogs: Locator[] = [];
    const leave = surface.getByRole('button', { name: /^(?:Leave session|Salir de la sesión)$/i });
    if (await leave.isVisible()) {
        await leave.click();
        // Page role locators do not cross iframe documents. A Frame may own
        // the confirmation itself or send an asynchronous request to its host.
        const surfaces = 'page' in surface && surface !== surface.page().mainFrame()
            ? [surface, surface.page()] : [surface];
        dialogs = surfaces.map((owner) => owner.getByRole('alertdialog', {
            name: /^(?:Leave the room\?|¿Salir de la sala\?|Leave session|Salir de la sesión)$/i,
        }));
        let counts: number[] = [];
        await expect.poll(async () => {
            counts = await Promise.all(dialogs.map((dialog) => dialog.count()));
            return counts.reduce((sum, count) => sum + count, 0);
        }, { message: 'room exit must present a confirmation in the room or its host' }).toBeGreaterThan(0);
        if (counts.reduce((sum, count) => sum + count, 0) !== 1) {
            throw new Error('Ambiguous room exit: multiple confirmation dialogs');
        }
        const ownerIndex = counts.findIndex((count) => count === 1);
        const confirmation = dialogs[ownerIndex];
        await confirmation.getByRole('button', {
            name: /^(?:Leave the room|Salir de la sala|Yes, leave the session|Sí, salir de la sesión)$/i,
        }).click();
        // Confirmation can finish asynchronously. Never select/click a second
        // owner while waiting for actual teardown, even if it appeared later.
        let ambiguous = false;
        await expect.poll(async () => {
            const pending = await Promise.all(dialogs.map((dialog) => dialog.count()));
            ambiguous ||= pending.some((count, index) => count > (index === ownerIndex ? 1 : 0));
            return ambiguous || await state.count() === 0;
        }, { message: 'confirmed room exit must disconnect without another confirmation owner' }).toBe(true);
        if (ambiguous) throw new Error('Ambiguous room exit: confirmation ownership changed during teardown');
    }
    // Also fail closed if the exit control was missing while still connected.
    await expect(state).toHaveCount(0);
    // A pending prompt is not successful teardown, including a same-document
    // successor that cannot be distinguished by its role/label alone.
    for (const dialog of dialogs) await expect(dialog).toHaveCount(0);
}

export const START_AUDIO = /Start audio|Iniciar audio/i;
// SDK 2.17.0 startAudio adds this one silent iOS workaround element. It is
// not a received source; do not exclude any other extra/invalid audio element.
export const RECEIVED_AUDIO = 'audio:not(#livekit-dummy-audio-el)';

/** Positive app + native readiness, not merely the absence of a button.
 * Intentional mute/zero volume are not playback failures.
 */
export async function expectEffectiveAudioReady(surface: Page | Frame): Promise<void> {
    const state = surface.getByTestId('connection-state');
    await expect(state).toHaveAttribute('data-state', 'connected', { timeout: 20_000 });
    await expect.poll(() => surface.locator(RECEIVED_AUDIO).evaluateAll((elements) =>
        elements.every((element) => element instanceof HTMLAudioElement &&
            !element.paused && !element.ended && !element.error,
        ),
    ), { message: 'an attached native audio source is still blocked' }).toBe(true);
    await expect(surface.getByRole('button', { name: START_AUDIO })).toHaveCount(0);
    // Diagnostic assertions follow native/UI behavior, never stand in for it.
    await expect(state).toHaveAttribute('data-beacon-audio', 'ready', { timeout: 20_000 });
    await expect(state).toHaveAttribute('data-stage-audio', 'ready', { timeout: 20_000 });
}

/** Allow automatic browser success OR exactly one explicit activation. Never
 * weaken this into an optional click without the effective readiness assertion.
 */
export async function activateAudioAtMostOnce(surface: Page | Frame): Promise<0 | 1> {
    const state = surface.getByTestId('connection-state');
    await expect(state).toHaveAttribute('data-state', 'connected', { timeout: 20_000 });
    const button = surface.getByRole('button', { name: START_AUDIO });
    const clicks = await button.isVisible() ? 1 : 0;
    if (clicks) await button.click();
    await expectEffectiveAudioReady(surface);
    return clicks;
}

/** Require actual received media, so a no-publisher/vacuous every() cannot
 * qualify the native playback path. Time must advance for each live source.
 */
export async function expectNativeAudioAdvancing(surface: Page | Frame, count: number): Promise<void> {
    await expect(surface.locator(RECEIVED_AUDIO)).toHaveCount(count, { timeout: 20_000 });
    const before = await surface.locator(RECEIVED_AUDIO).evaluateAll((elements) =>
        elements.map((element) => ({
            time: (element as HTMLAudioElement).currentTime,
            tracks: ((element as HTMLAudioElement).srcObject as MediaStream)?.getAudioTracks().map((track) => track.id),
        })),
    );
    expect(before.every((source) => source.tracks?.length === 1)).toBe(true);
    expect(new Set(before.flatMap((source) => source.tracks)).size).toBe(count);
    await expect.poll(() => surface.locator(RECEIVED_AUDIO).evaluateAll((elements, previous) =>
        elements.length === previous.length && elements.every((element, index) => {
            const audio = element as HTMLAudioElement;
            const stream = audio.srcObject as MediaStream | null;
            return !audio.paused && !audio.ended && !audio.error &&
                stream?.getAudioTracks()[0]?.id === previous[index].tracks?.[0] &&
                audio.currentTime > previous[index].time;
        }), before,
    ), { timeout: 20_000, message: 'received native audio did not advance' }).toBe(true);
}
