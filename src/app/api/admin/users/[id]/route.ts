import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';

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

        // Prevent self-demotion if last admin (optional check, good practice)
        // For simplicity, just update
        await prisma.user.update({
            where: { id },
            data: { role }
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
    }
}
