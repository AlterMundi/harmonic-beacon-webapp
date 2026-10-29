import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

/** Only PostgreSQL serialization/deadlock rejection, never an uncertain commit. */
function isAdapterWriteConflict(error: unknown): boolean {
    // adapter-pg exposes COMMIT failures directly as DriverAdapterError in
    // Prisma 7. SQLSTATE 40001 is translated to this discriminated kind.
    return error instanceof Error && error.name === 'DriverAdapterError' &&
        'cause' in error && typeof error.cause === 'object' && error.cause !== null &&
        'kind' in error.cause && error.cause.kind === 'TransactionWriteConflict';
}

export function isPresenceWriteConflict(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2034') return true;
        // $queryRaw's row-lock rejection is P2010 with the same typed adapter
        // cause. P2010 alone also represents unrelated/uncertain failures.
        if (error.code === 'P2010') return isAdapterWriteConflict(error.meta?.driverAdapterError);
    }
    return isAdapterWriteConflict(error);
}

/** The callback contains DB writes only and can be replayed after a rollback. */
export async function presenceTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
        try {
            return await prisma.$transaction(work, { isolationLevel: 'Serializable' });
        } catch (error) {
            if (!isPresenceWriteConflict(error) || attempt >= 4) throw error;
            await new Promise(resolve => setTimeout(resolve, 10 * 2 ** attempt + Math.floor(Math.random() * 15)));
        }
    }
}
