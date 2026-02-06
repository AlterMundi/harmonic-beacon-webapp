import { NextRequest, NextResponse } from 'next/server';

// Zitadel configuration
const ZITADEL_ISSUER = process.env.ZITADEL_ISSUER;
const ZITADEL_INTROSPECTION_URL = process.env.ZITADEL_INTROSPECTION_URL;
const ZITADEL_CLIENT_ID = process.env.ZITADEL_CLIENT_ID;
const ZITADEL_CLIENT_SECRET = process.env.ZITADEL_CLIENT_SECRET;

export interface ZitadelUser {
    sub: string;
    email?: string;
    name?: string;
    roles: string[];
    active: boolean;
}

/**
 * Validate a Zitadel access token using token introspection
 */
export async function validateZitadelToken(token: string): Promise<ZitadelUser | null> {
    if (!ZITADEL_INTROSPECTION_URL || !ZITADEL_CLIENT_ID || !ZITADEL_CLIENT_SECRET) {
        console.error('Zitadel configuration missing');
        return null;
    }

    try {
        const response = await fetch(ZITADEL_INTROSPECTION_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${Buffer.from(`${ZITADEL_CLIENT_ID}:${ZITADEL_CLIENT_SECRET}`).toString('base64')}`,
            },
            body: new URLSearchParams({
                token,
                token_type_hint: 'access_token',
            }),
        });

        if (!response.ok) {
            console.error('Token introspection failed:', response.status);
            return null;
        }

        const data = await response.json();

        if (!data.active) {
            return null;
        }

        // Extract roles from Zitadel claims
        const roles: string[] = [];
        if (data['urn:zitadel:iam:org:project:roles']) {
            roles.push(...Object.keys(data['urn:zitadel:iam:org:project:roles']));
        }

        return {
            sub: data.sub,
            email: data.email,
            name: data.name || data.preferred_username,
            roles,
            active: true,
        };
    } catch (error) {
        console.error('Error validating Zitadel token:', error);
        return null;
    }
}

/**
 * Extract Bearer token from Authorization header
 */
export function extractBearerToken(request: NextRequest): string | null {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    return authHeader.substring(7);
}

/**
 * Middleware to require authentication
 */
export async function requireAuth(request: NextRequest): Promise<ZitadelUser | NextResponse> {
    const token = extractBearerToken(request);

    if (!token) {
        return NextResponse.json(
            { error: 'Authorization header missing or invalid' },
            { status: 401 }
        );
    }

    const user = await validateZitadelToken(token);

    if (!user) {
        return NextResponse.json(
            { error: 'Invalid or expired token' },
            { status: 401 }
        );
    }

    return user;
}

/**
 * Middleware to require specific role
 */
export async function requireRole(
    request: NextRequest,
    requiredRole: string
): Promise<ZitadelUser | NextResponse> {
    const result = await requireAuth(request);

    if (result instanceof NextResponse) {
        return result;
    }

    if (!result.roles.includes(requiredRole) && !result.roles.includes('admin')) {
        return NextResponse.json(
            { error: 'Insufficient permissions' },
            { status: 403 }
        );
    }

    return result;
}

/**
 * Check if user is a certified provider
 */
export async function requireProvider(request: NextRequest): Promise<ZitadelUser | NextResponse> {
    return requireRole(request, 'certified_provider');
}

/**
 * Check if user is an admin
 */
export async function requireAdmin(request: NextRequest): Promise<ZitadelUser | NextResponse> {
    return requireRole(request, 'admin');
}
