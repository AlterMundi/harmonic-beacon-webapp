import { expect, test } from '@playwright/test';
import { leaveConnectedRoom } from '../audio-readiness';

// Independent-review F1: both prompts originate in one exit request. The
// second native modal appears while genuine asynchronous teardown is pending.
for (const disconnect of [true, false]) {
    test(`rejects a delayed second owner; disconnect=${disconnect}`, async ({ page }) => {
        await page.setContent('<iframe title="Room"></iframe>');
        const room = page.frames()[1];
        await room.setContent('<span data-testid="connection-state">Connected</span><button id="leave">Leave session</button>');
        await page.evaluate(({ disconnect }) => {
            const room = document.querySelector('iframe')!.contentDocument!;
            document.body.dataset.confirmations = '0';
            room.querySelector<HTMLButtonElement>('#leave')!.onclick = () => {
                const local = room.createElement('section');
                local.setAttribute('role', 'alertdialog');
                local.setAttribute('aria-label', 'Leave session');
                local.innerHTML = '<button>Yes, leave the session</button>';
                room.body.append(local);
                let showParent: () => void;
                const pendingParent = new Promise<void>((resolve) => {
                    showParent = () => {
                        const parent = document.createElement('dialog');
                        parent.setAttribute('role', 'alertdialog');
                        parent.setAttribute('aria-label', 'Leave the room?');
                        parent.innerHTML = '<button>Leave the room</button>';
                        parent.querySelector('button')!.onclick = () => {
                            document.body.dataset.confirmations = '2';
                        };
                        document.body.append(parent);
                        parent.showModal();
                        resolve();
                    };
                });
                local.querySelector('button')!.onclick = () => {
                    document.body.dataset.confirmations = '1';
                    local.remove();
                    // Causal scheduling after the first choice avoids depending
                    // on machine speed to decide which prompt is clicked first.
                    setTimeout(showParent, 150);
                    if (disconnect) void pendingParent.then(() => {
                        room.querySelector('[data-testid="connection-state"]')!.remove();
                    });
                };
            };
        }, { disconnect });
        await expect(leaveConnectedRoom(room)).rejects.toThrow(/Ambiguous room exit/);
        await expect(page.locator('body')).toHaveAttribute('data-confirmations', '1');
        await expect(page.getByRole('alertdialog')).toHaveCount(1);
        await expect(room.getByTestId('connection-state')).toHaveCount(disconnect ? 0 : 1);
    });
}

test('confirmation that leaves its own prompt open is not successful teardown', async ({ page }) => {
    await page.setContent('<span data-testid="connection-state">Connected</span><button id="leave">Leave session</button>');
    await page.evaluate(() => {
        document.body.dataset.confirmations = '0';
        document.querySelector<HTMLButtonElement>('#leave')!.onclick = () => {
            const dialog = document.createElement('dialog');
            dialog.setAttribute('role', 'alertdialog');
            dialog.setAttribute('aria-label', 'Leave the room?');
            dialog.innerHTML = '<button>Leave the room</button>';
            dialog.querySelector('button')!.onclick = () => {
                document.body.dataset.confirmations = '1';
                document.querySelector('[data-testid="connection-state"]')!.remove();
            };
            document.body.append(dialog);
            dialog.showModal();
        };
    });
    await expect(leaveConnectedRoom(page)).rejects.toThrow();
    await expect(page.locator('body')).toHaveAttribute('data-confirmations', '1');
    await expect(page.getByRole('alertdialog')).toHaveCount(1);
    await expect(page.getByTestId('connection-state')).toHaveCount(0);
});
