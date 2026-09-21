import { NextRequest, NextResponse } from 'next/server';

import { requireStaffCapability } from '@/lib/auth';
import {
    SessionCapacityError,
    setSessionSceneCapacity,
} from '@/lib/session-capacity';
import { isSceneCapacity } from '@/lib/scene-capacity';

export const dynamic = 'force-dynamic';

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const [staff, errorResponse] = await requireStaffCapability('administer_system');
    if (!staff) return errorResponse;

    const invalidCapacity = () => NextResponse.json(
        { error: 'invalid_capacity', message: 'maxPublishers must be one of 6, 9, or 12' },
        { status: 400 },
    );
    let body: Record<string, unknown>;
    try {
        const parsed: unknown = await request.json();
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return invalidCapacity();
        }
        body = parsed as Record<string, unknown>;
    } catch {
        return invalidCapacity();
    }
    if (!isSceneCapacity(body.maxPublishers)) return invalidCapacity();

    const { id } = await params;
    try {
        const result = await setSessionSceneCapacity({
            scheduledSessionId: id,
            actorUserId: staff.userId,
            actorRole: staff.role,
            maxPublishers: body.maxPublishers,
            reason: typeof body.reason === 'string' ? body.reason : undefined,
        });
        return NextResponse.json(result);
    } catch (error) {
        if (error instanceof SessionCapacityError) {
            return NextResponse.json(
                { error: error.code, message: error.message, ...error.details },
                { status: error.status },
            );
        }
        throw error;
    }
}
