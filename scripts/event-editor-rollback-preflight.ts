import { prisma } from '../src/lib/db';
import { verifyEventEditorRollbackSafety } from '../src/lib/event-editor-rollback';

verifyEventEditorRollbackSafety(prisma)
    .then(() => { process.stdout.write('event-editor rollback compatible\n'); })
    .catch(() => { process.stderr.write('event-editor rollback refused; preserve fence and roll forward\n'); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
