import { expect, it, vi } from 'vitest';
import { verifyEventEditorRollbackSafety } from '../event-editor-rollback';

it.each([false, true, null])('only explicit compatible inspection permits rollback: %s', async (incompatible) => {
    const tx = { $executeRawUnsafe: vi.fn(), $queryRawUnsafe: vi.fn().mockResolvedValue([{ incompatible }]) };
    const db = { $transaction: vi.fn(async (fn: (arg: typeof tx) => unknown) => fn(tx)) };
    const result = verifyEventEditorRollbackSafety(db as never);
    if (incompatible === false) await expect(result).resolves.toEqual({ eligibleForOldBinaryRollback: true });
    else await expect(result).rejects.toThrow('event_editor_old_binary_rollback_refused');
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('ACCESS EXCLUSIVE'));
    const sql = tx.$queryRawUnsafe.mock.calls[0][0];
    for (const field of ['is_published', 'checkout_url', 'event.created', 'event.updated']) expect(sql).toContain(field);
});
