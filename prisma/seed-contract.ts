export const WEEKEND_ATTENDEE_CAP = 150;
export const WEEKEND_MAX_PUBLISHERS = 6;
export const WEEKEND_SESSION_COOKIE_TTL_SECONDS = 7 * 24 * 60 * 60;

export type WeekendLanguage = 'ENGLISH' | 'SPANISH';
export type WeekendStaffRole = 'FACILITATOR' | 'FACILITATOR_OP' | 'OPERATOR' | 'ADMIN';

export type EventDefinition = {
    id: string;
    title: string;
    description?: string;
    roomName: string;
    scheduledAt: Date;
    language: WeekendLanguage;
    isTest: false;
};

export type StaffDefinition = {
    email: string;
    name: string;
    passwordDigest: string;
    role: WeekendStaffRole;
    accountSubject?: string;
};

function accountSubject(env: NodeJS.ProcessEnv, name: string): string | undefined {
    const value = env[name]?.trim();
    if (env.BEACON_ACCOUNT_ENABLED === 'true' && !value) {
        throw new Error(`Missing required seed environment variable: ${name}`);
    }
    if (value && (value.length > 512 || !/^[\x21-\x7e]+$/.test(value))) {
        throw new Error(`${name} must be an opaque printable subject of at most 512 characters`);
    }
    return value || undefined;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
    const value = env[name]?.trim();
    if (!value) {
        throw new Error(`Missing required seed environment variable: ${name}`);
    }
    return value;
}

function parseCredentialDigest(env: NodeJS.ProcessEnv, name: string): string {
    const value = required(env, name);
    const match = /^scrypt\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(value);
    if (!match) {
        throw new Error(`${name} must use the scrypt$<salt-base64url>$<digest-base64url> format`);
    }

    const salt = Buffer.from(match[1], 'base64url');
    const digest = Buffer.from(match[2], 'base64url');
    if (salt.length < 16 || digest.length < 32) {
        throw new Error(`${name} must contain at least a 16-byte salt and 32-byte digest`);
    }
    return value;
}

function facilitatorRole(env: NodeJS.ProcessEnv): 'FACILITATOR' | 'FACILITATOR_OP' {
    const value = env.STAFF_FACILITATOR_ROLE?.trim() || 'FACILITATOR';
    if (value !== 'FACILITATOR' && value !== 'FACILITATOR_OP') {
        throw new Error('STAFF_FACILITATOR_ROLE must be FACILITATOR or FACILITATOR_OP');
    }
    return value;
}

function parseEvent(
    env: NodeJS.ProcessEnv,
    name: string,
    expectedDate: string,
    language: WeekendLanguage,
): EventDefinition {
    let input: unknown;
    try {
        input = JSON.parse(required(env, name));
    } catch {
        throw new Error(`${name} must be valid JSON`);
    }

    if (!input || typeof input !== 'object') {
        throw new Error(`${name} must be a JSON object`);
    }

    const value = input as Record<string, unknown>;
    const id = typeof value.id === 'string' ? value.id.trim() : '';
    const title = typeof value.title === 'string' ? value.title.trim() : '';
    const description = typeof value.description === 'string' ? value.description.trim() : undefined;
    const roomName = typeof value.roomName === 'string' ? value.roomName.trim() : '';
    const scheduledAt = typeof value.scheduledAt === 'string' ? new Date(value.scheduledAt) : new Date(Number.NaN);

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        throw new Error(`${name}.id must be a UUID`);
    }
    if (!title || !roomName || Number.isNaN(scheduledAt.getTime())) {
        throw new Error(`${name} requires non-empty title, roomName, and ISO scheduledAt fields`);
    }
    if (scheduledAt.toISOString().slice(0, 10) !== expectedDate) {
        throw new Error(`${name}.scheduledAt must fall on ${expectedDate} UTC`);
    }

    return { id, title, description, roomName, scheduledAt, language, isTest: false };
}

export function loadSeedContract(
    env: NodeJS.ProcessEnv = process.env,
): { staff: StaffDefinition[]; events: EventDefinition[] } {
    const staff: StaffDefinition[] = [
        {
            name: required(env, 'STAFF_FACILITATOR_NAME'),
            email: required(env, 'STAFF_FACILITATOR_EMAIL').toLowerCase(),
            passwordDigest: parseCredentialDigest(env, 'STAFF_FACILITATOR_PASSWORD_DIGEST'),
            role: facilitatorRole(env),
            accountSubject: accountSubject(env, 'STAFF_FACILITATOR_ACCOUNT_SUBJECT'),
        },
        {
            name: required(env, 'STAFF_OPERATOR_ONE_NAME'),
            email: required(env, 'STAFF_OPERATOR_ONE_EMAIL').toLowerCase(),
            passwordDigest: parseCredentialDigest(env, 'STAFF_OPERATOR_ONE_PASSWORD_DIGEST'),
            role: 'OPERATOR',
            accountSubject: accountSubject(env, 'STAFF_OPERATOR_ONE_ACCOUNT_SUBJECT'),
        },
        {
            name: required(env, 'STAFF_OPERATOR_TWO_NAME'),
            email: required(env, 'STAFF_OPERATOR_TWO_EMAIL').toLowerCase(),
            passwordDigest: parseCredentialDigest(env, 'STAFF_OPERATOR_TWO_PASSWORD_DIGEST'),
            role: 'OPERATOR',
            accountSubject: accountSubject(env, 'STAFF_OPERATOR_TWO_ACCOUNT_SUBJECT'),
        },
        {
            name: required(env, 'STAFF_ADMIN_NAME'),
            email: required(env, 'STAFF_ADMIN_EMAIL').toLowerCase(),
            passwordDigest: parseCredentialDigest(env, 'STAFF_ADMIN_PASSWORD_DIGEST'),
            role: 'ADMIN',
            accountSubject: accountSubject(env, 'STAFF_ADMIN_ACCOUNT_SUBJECT'),
        },
    ];

    if (new Set(staff.map(({ email }) => email)).size !== staff.length) {
        throw new Error('Staff seed emails must be unique after normalization');
    }
    if (new Set(staff.map(({ passwordDigest }) => passwordDigest)).size !== staff.length) {
        throw new Error('Staff credential digests must use unique per-user salts');
    }
    const configuredSubjects = staff.flatMap(({ accountSubject }) => accountSubject ? [accountSubject] : []);
    if (new Set(configuredSubjects).size !== configuredSubjects.length) {
        throw new Error('Staff Beacon Account subjects must be unique');
    }

    const configuredTtl = Number(required(env, 'SESSION_COOKIE_TTL_SECONDS'));
    if (
        !Number.isSafeInteger(configuredTtl) ||
        configuredTtl !== WEEKEND_SESSION_COOKIE_TTL_SECONDS
    ) {
        throw new Error(
            `SESSION_COOKIE_TTL_SECONDS must be ${WEEKEND_SESSION_COOKIE_TTL_SECONDS} for the weekend`,
        );
    }

    return {
        staff,
        events: [
            parseEvent(env, 'WEEKEND_SESSION_1_EVENT_JSON', '2026-08-08', 'SPANISH'),
            parseEvent(env, 'WEEKEND_SESSION_2_EVENT_JSON', '2026-08-08', 'ENGLISH'),
        ],
    };
}
