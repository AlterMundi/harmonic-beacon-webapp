import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

/** Only PostgreSQL serialization/deadlock rejection, never an uncertain commit. */
export function isPresenceWriteConflict(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return true;
    // adapter-pg exposes COMMIT failures directly as DriverAdapterError in
    // Prisma 7. SQLSTATE 40001 is translated to this discriminated kind.
    return error instanceof Error && error.name === 'DriverAdapterError' &&
        'cause' in error && typeof error.cause === 'object' && error.cause !== null &&
        'kind' in error.cause && error.cause.kind === 'TransactionWriteConflict';
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
