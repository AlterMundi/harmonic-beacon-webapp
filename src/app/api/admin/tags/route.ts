import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';

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

        return NextResponse.json({ tag });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to create tag', details: error }, { status: 500 });
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

        await prisma.tag.delete({
            where: { id }
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to delete tag' }, { status: 500 });
    }
}
