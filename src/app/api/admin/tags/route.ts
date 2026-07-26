import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { logAdminAction } from '@/lib/audit';
import { redactErrorDetail } from '@/lib/redact';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const [session, errorResponse] = await requireRole('ADMIN');
    if (!session) return errorResponse;

    try {
        const { name, category } = await request.json();

        if (!name || !category) {
            return NextResponse.json({ error: 'Name and category are required' }, { status: 400 });
        }

        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

        const tag = await prisma.tag.create({
            data: {
                name,
                slug,
                category
            }
        });

        await logAdminAction(session, {
            action: 'tag.create',
            targetType: 'TAG',
            targetId: tag.id,
            metadata: { slug: tag.slug, category: tag.category },
        });

        return NextResponse.json({ tag });
    } catch (error) {
        console.error('Failed to create tag:', redactErrorDetail(error));
        return NextResponse.json({ error: 'Failed to create tag' }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    const [session, errorResponse] = await requireRole('ADMIN');
    if (!session) return errorResponse;

    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'Tag ID is required' }, { status: 400 });
        }

        // Deleting a tag cascades through `meditation_tags`, so the slug and
        // category are gone from the DB the moment this returns. Capture them in
        // the audit entry before the delete or the log records only an opaque uuid.
        const tag = await prisma.tag.findUnique({
            where: { id },
            select: { slug: true, category: true },
        });

        await prisma.tag.delete({
            where: { id }
        });

        await logAdminAction(session, {
            action: 'tag.delete',
            targetType: 'TAG',
            targetId: id,
            metadata: { slug: tag?.slug ?? null, category: tag?.category ?? null },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete tag:', redactErrorDetail(error));
        return NextResponse.json({ error: 'Failed to delete tag' }, { status: 500 });
    }
}
