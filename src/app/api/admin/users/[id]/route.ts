import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { logAdminAction } from '@/lib/audit';
import { redactErrorDetail } from '@/lib/redact';

export const dynamic = 'force-dynamic';

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const [session, errorResponse] = await requireRole('ADMIN');
    if (!session) return errorResponse;

    try {
        const { role } = await request.json();

        // Validation
        if (!['USER', 'LISTENER', 'PROVIDER', 'ADMIN'].includes(role)) {
            return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
        }

        // Read the outgoing role before overwriting it: TRUST_AND_SAFETY.md §2.2
        // wants the role change itself in the log, and "granted PROVIDER" is only
        // meaningful next to what the account held before.
        const target = await prisma.user.findUnique({
            where: { id },
            select: { role: true },
        });

        if (!target) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        // Prevent self-demotion if last admin (optional check, good practice)
        // For simplicity, just update
        await prisma.user.update({
            where: { id },
            data: { role }
        });

        await logAdminAction(session, {
            action: 'user.role_change',
            targetType: 'USER',
            targetId: id,
            metadata: { previousRole: target.role, newRole: role },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to update user role:', redactErrorDetail(error));
        return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
    }
}
