#!/usr/bin/env node
/**
 * Backfill `Meditation.durationSeconds` for rows stored before the upload route
 * probed audio. Every meditation uploaded until then recorded 0, and no edit
 * path could correct it, so the `completed` rule in BUSINESS_RULES.md §2.3 —
 * a fraction of the declared duration — was unenforceable for that content.
 *
 * Idempotent: only touches rows where `durationSeconds` is 0, so re-running it
 * after a partial failure resumes rather than redoes.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/backfill-durations.mjs [--apply]
 *
 * Defaults to a DRY RUN and prints what it would change. Pass --apply to write.
 * Run it from the machine holding the audio: it reads the files, so the paths in
 * MEDITATIONS_STORAGE_PATH and UPLOADS_PATH must resolve locally.
 */

import { PrismaClient } from '@prisma/client';
import { join } from 'path';
import { existsSync } from 'fs';
import { getAudioDurationSeconds } from '../src/lib/audio-duration.ts';

const APPLY = process.argv.includes('--apply');

const MEDITATIONS_PATH = process.env.MEDITATIONS_STORAGE_PATH;
const UPLOADS_PATH = process.env.UPLOADS_PATH;

if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required.');
    process.exit(2);
}
if (!MEDITATIONS_PATH || !UPLOADS_PATH) {
    console.error('MEDITATIONS_STORAGE_PATH and UPLOADS_PATH are both required — approved and pending files live in different places.');
    process.exit(2);
}

const prisma = new PrismaClient();

/** Approved content moves to the meditations directory; everything else stays in uploads. */
function resolvePath(meditation) {
    const base = meditation.status === 'APPROVED' ? MEDITATIONS_PATH : UPLOADS_PATH;
    return join(base, meditation.filePath);
}

async function main() {
    const rows = await prisma.meditation.findMany({
        where: { durationSeconds: 0 },
        select: { id: true, title: true, filePath: true, status: true },
    });

    console.log(`${rows.length} meditation(s) with no recorded duration.`);
    console.log(APPLY ? 'Mode: APPLY\n' : 'Mode: DRY RUN — pass --apply to write\n');

    let updated = 0, missing = 0, failed = 0;

    for (const row of rows) {
        const path = resolvePath(row);

        if (!existsSync(path)) {
            console.log(`  MISSING  ${row.title} — no file at ${path}`);
            missing++;
            continue;
        }

        try {
            const seconds = await getAudioDurationSeconds(path);
            console.log(`  ${APPLY ? 'SET     ' : 'WOULD SET'} ${row.title} -> ${seconds}s`);
            if (APPLY) {
                await prisma.meditation.update({
                    where: { id: row.id },
                    data: { durationSeconds: seconds },
                });
            }
            updated++;
        } catch (err) {
            console.log(`  FAILED   ${row.title} — ${err.message}`);
            failed++;
        }
    }

    console.log(`\n${updated} ${APPLY ? 'updated' : 'would be updated'}, ${missing} missing file, ${failed} probe failure.`);
    if (missing || failed) {
        console.log('Rows left at 0 stay eligible for the next run — this script is idempotent.');
    }
}

main()
    .catch((err) => {
        console.error('backfill failed:', err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
