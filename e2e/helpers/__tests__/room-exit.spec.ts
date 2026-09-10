import { expect, test, type Page } from '@playwright/test';
import { leaveConnectedRoom } from '../audio-readiness';

// Isolated DOM component contract, not a substitute for actual LiveKit E2E.
// The iframe owns its own DOM. Parent-hosted mode crosses an async message
// boundary, as #70 does, and only confirmation is permitted to tear down state.
const copies = [
    { locale: 'en', leave: 'Leave session', local: 'Leave session', localYes: 'Yes, leave the session', parent: 'Leave the room?', parentYes: 'Leave the room' },
    { locale: 'es', leave: 'Salir de la sesión', local: 'Salir de la sesión', localYes: 'Sí, salir de la sesión', parent: '¿Salir de la sala?', parentYes: 'Salir de la sala' },
];
async function fixture(page: Page, owner: 'page' | 'frame' | 'parent' | 'both' | 'none', copy = copies[1], disconnect = true) {
    await page.setContent(owner === 'page' ? '<main></main>' : '<iframe title="Persistent room"></iframe>');
    const surface = owner === 'page' ? page : page.frames()[1];
    await surface.setContent(`<span data-testid="connection-state" data-state="connected">Connected</span><button id="leave">${copy.leave}</button>`);
    await page.evaluate(({ owner, copy, disconnect }) => {
        const room = owner === 'page' ? document : document.querySelector('iframe')!.contentDocument!;
        document.body.dataset.confirmations = '0';
        const prompt = (doc: Document, parent: boolean) => {
            // Match #70's actual native top-layer modal, not a clickable
            // section that would miss showModal/inert/focus behavior.
            const dialog = doc.createElement(parent ? 'dialog' : 'section');
            dialog.setAttribute('role', 'alertdialog');
            dialog.setAttribute('aria-modal', 'true');
            dialog.setAttribute('aria-label', parent ? copy.parent : copy.local);
            dialog.innerHTML = `<button>${parent ? copy.parentYes : copy.localYes}</button><button>Cancel</button>`;
            dialog.querySelector('button')!.onclick = () => {
                document.body.dataset.confirmations = String(Number(document.body.dataset.confirmations) + 1);
                if (disconnect) room.querySelector('[data-testid="connection-state"]')!.remove();
                dialog.remove();
            };
            doc.body.append(dialog);
            if (dialog instanceof HTMLDialogElement) dialog.showModal();
        };
        window.addEventListener('message', (event) => {
            if (event.data === 'room-exit-contract') prompt(document, true);
        });
        room.querySelector<HTMLButtonElement>('#leave')!.onclick = () => {
            if (owner === 'page' || owner === 'frame' || owner === 'both') prompt(room, false);
            if (owner === 'parent') window.postMessage('room-exit-contract', '*');
            if (owner === 'both') prompt(document, true);
        };
    }, { owner, copy, disconnect });
    return surface;
}

for (const owner of ['page', 'frame', 'parent'] as const) {
    for (const copy of copies) {
        test(`${owner} ${copy.locale}: exactly one confirmation precedes disconnection`, async ({ page }) => {
            const surface = await fixture(page, owner, copy);
            await leaveConnectedRoom(surface);
            await expect(page.locator('body')).toHaveAttribute('data-confirmations', '1');
            await expect(surface.getByTestId('connection-state')).toHaveCount(0);
            await expect(surface.getByRole('alertdialog')).toHaveCount(0);
            await expect(page.getByRole('alertdialog')).toHaveCount(0);
        });
    }
}
test('main Frame is one document, not two confirmation owners', async ({ page }) => {
    await fixture(page, 'page');
    await leaveConnectedRoom(page.mainFrame());
    await expect(page.locator('body')).toHaveAttribute('data-confirmations', '1');
    await expect(page.getByTestId('connection-state')).toHaveCount(0);
});

test('missing exit control cannot conceal a connected room', async ({ page }) => {
    const surface = await fixture(page, 'frame');
    await surface.locator('#leave').evaluate((button) => button.remove());
    await expect(leaveConnectedRoom(surface)).rejects.toThrow();
    await expect(surface.getByTestId('connection-state')).toHaveCount(1);
    await expect(page.locator('body')).toHaveAttribute('data-confirmations', '0');
});

test('already disconnected room requires no confirmation', async ({ page }) => {
    await page.setContent('<main>Exited</main>');
    await leaveConnectedRoom(page);
    await expect(page.getByTestId('connection-state')).toHaveCount(0);
});

for (const owner of ['both', 'none'] as const) {
    test(`${owner}: rejects invalid ownership without confirming`, async ({ page }) => {
        const surface = await fixture(page, owner);
        await expect(leaveConnectedRoom(surface)).rejects.toThrow();
        await expect(page.locator('body')).toHaveAttribute('data-confirmations', '0');
        await expect(surface.getByTestId('connection-state')).toHaveCount(1);
    });
}
for (const owner of ['frame', 'parent'] as const) {
    test(`${owner}: confirmation without disconnection fails`, async ({ page }) => {
        const surface = await fixture(page, owner, copies[1], false);
        await expect(leaveConnectedRoom(surface)).rejects.toThrow();
        await expect(page.locator('body')).toHaveAttribute('data-confirmations', '1');
        await expect(surface.getByTestId('connection-state')).toHaveCount(1);
    });
}
