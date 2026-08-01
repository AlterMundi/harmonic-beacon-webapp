import { NextRequest, NextResponse } from 'next/server';

import {
    COMMERCE_ERROR_SCHEMA,
    CommerceContractError,
    parseCommerceCommand,
} from '@/lib/commerce-contract';
import {
    applyCommerceCommand,
    getCommerceEntitlement,
} from '@/lib/commerce-entitlement';
import { authorizeCommerceService } from '@/lib/commerce-service-auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16 * 1024;
const EXTERNAL_TICKET_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const NO_STORE = { 'Cache-Control': 'private, no-store' };

function response(body: unknown, status = 200): NextResponse {
    return NextResponse.json(body, { status, headers: NO_STORE });
}

function errorResponse(
    status: number,
    code: string,
    message: string,
    retryable: boolean,
    requestId: string | null = null,
): NextResponse {
    return response({
        schema_version: COMMERCE_ERROR_SCHEMA,
        request_id: requestId,
        code,
        message,
        retryable,
    }, status);
}

function authorized(request: NextRequest): boolean {
    return authorizeCommerceService(
        request.headers.get('authorization'),
        request.headers.get('x-hb-service-key-id'),
    );
}

function validPath(value: string): boolean {
    return EXTERNAL_TICKET_ID.test(value);
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ externalTicketId: string }> },
): Promise<NextResponse> {
    if (!authorized(request)) {
        return errorResponse(401, 'unauthorized', 'Service authentication failed', false);
    }

    const { externalTicketId } = await params;
    if (!validPath(externalTicketId)) {
        return errorResponse(404, 'not_found', 'Resource not found', false);
    }
    if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
        return errorResponse(400, 'invalid_request', 'Content-Type must be application/json', false);
    }
    const contentLength = Number(request.headers.get('content-length') || '0');
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
        return errorResponse(413, 'request_too_large', 'Request body exceeds 16 KiB', false);
    }

    let raw: string;
    try {
        raw = await request.text();
    } catch {
        return errorResponse(400, 'invalid_json', 'Request body is not readable JSON', false);
    }
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
        return errorResponse(413, 'request_too_large', 'Request body exceeds 16 KiB', false);
    }

    let input: unknown;
    try {
        input = JSON.parse(raw) as unknown;
    } catch {
        return errorResponse(400, 'invalid_json', 'Request body is not valid JSON', false);
    }

    let requestId: string | null = null;
    try {
        const command = parseCommerceCommand(input);
        requestId = command.request_id;
        const expectedIdempotencyKey =
            `beacon-entitlement:ticket-tailor:${command.external_ticket_id}:${command.provision_revision}`;
        if (request.headers.get('idempotency-key') !== expectedIdempotencyKey) {
            throw new CommerceContractError(
                422,
                'idempotency_key_mismatch',
                'Idempotency-Key does not match the command resource and revision',
            );
        }
        return response(await applyCommerceCommand(command, externalTicketId));
    } catch (error) {
        if (error instanceof CommerceContractError) {
            return errorResponse(error.status, error.code, error.message, error.retryable, requestId);
        }
        console.error('[commerce-entitlement] apply failed without request material');
        return errorResponse(500, 'internal_error', 'Beacon could not apply the command', true, requestId);
    }
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ externalTicketId: string }> },
): Promise<NextResponse> {
    if (!authorized(request)) {
        return errorResponse(401, 'unauthorized', 'Service authentication failed', false);
    }
    const { externalTicketId } = await params;
    if (!validPath(externalTicketId)) {
        return errorResponse(404, 'not_found', 'Resource not found', false);
    }
    try {
        const entitlement = await getCommerceEntitlement(externalTicketId);
        return entitlement
            ? response(entitlement)
            : errorResponse(404, 'not_found', 'Resource not found', false);
    } catch {
        console.error('[commerce-entitlement] reconciliation read failed');
        return errorResponse(500, 'internal_error', 'Beacon could not read the resource', true);
    }
}
