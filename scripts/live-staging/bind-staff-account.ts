#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

export const STAGING_ACCOUNT_ISSUER = 'https://account-staging.harmonicbeacon.com';
export const STAGING_DATABASE_NAME = 'beacon_live_staging';
export const INPUT_PATH = '/run/harmonic-beacon/staff-account-binding.env';
export const AUDIT_ACTION = 'account.staff.binding.provisioned';

export type BindingInput = {
    accountIssuer: string;
    accountSubject: string;
    staffUserId: string;
};

export type BindingResult = {
    outcome: 'would-create' | 'created' | 'already-bound';
    bindingId: string | null;
};

export class BindingConflictError extends Error {}

function fail(message: string): never {
    throw new Error(message);
}

export function parseBindingInput(contents: string): BindingInput {
    const values = new Map<string, string>();
    for (const rawLine of contents.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const separator = line.indexOf('=');
        if (separator < 1) fail('invalid binding input');
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1);
        if (!/^[A-Z][A-Z0-9_]*$/.test(key) || values.has(key)) fail('invalid or duplicate binding input key');
        values.set(key, value);
    }

    const allowed = new Set(['ACCOUNT_ISSUER', 'ACCOUNT_SUBJECT', 'STAFF_USER_ID']);
    if ([...values.keys()].some((key) => !allowed.has(key)) || values.size !== allowed.size) {
        fail('binding input must contain exactly ACCOUNT_ISSUER, ACCOUNT_SUBJECT and STAFF_USER_ID');
    }

    const accountIssuer = values.get('ACCOUNT_ISSUER') ?? '';
    const accountSubject = values.get('ACCOUNT_SUBJECT') ?? '';
    const staffUserId = values.get('STAFF_USER_ID') ?? '';
    if (accountIssuer !== STAGING_ACCOUNT_ISSUER) fail('Account issuer is not the exact staging issuer');
    if (accountSubject.length < 1 || accountSubject.length > 255 || /[\u0000-\u0020\u007f]/.test(accountSubject)) {
        fail('Account subject must be an opaque, non-empty value without whitespace or control characters');
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(staffUserId)) {
        fail('staff user ID must be a UUID');
    }
    return { accountIssuer, accountSubject, staffUserId: staffUserId.toLowerCase() };
}

export function validateStagingEnvironment(environment: Record<string, string | undefined>): URL {
    if (environment.LIVE_STAGING_STAFF_BINDING_ENABLED !== '1') {
        fail('staff binding utility is disabled; set LIVE_STAGING_STAFF_BINDING_ENABLED=1 explicitly');
    }
    if (environment.LIVE_STAGING_ENVIRONMENT !== 'live-staging') fail('exact live-staging environment marker required');
    const databaseUrl = new URL(environment.DATABASE_URL ?? fail('DATABASE_URL is required'));
    if (databaseUrl.protocol !== 'postgresql:' && databaseUrl.protocol !== 'postgres:') fail('PostgreSQL DATABASE_URL required');
    if (databaseUrl.pathname !== `/${STAGING_DATABASE_NAME}`) fail('refusing a database other than beacon_live_staging');
    return databaseUrl;
}

export async function readRootOnlyBindingInput(path = INPUT_PATH): Promise<BindingInput> {
    if (path !== INPUT_PATH) fail('binding input path is fixed');
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0 ||
        (metadata.mode & 0o777) !== 0o600) {
        fail(`${INPUT_PATH} must be a root:root mode-0600 regular file`);
    }
    return parseBindingInput(await readFile(path, 'utf8'));
}

async function inspectBinding(tx: Prisma.TransactionClient, input: BindingInput): Promise<BindingResult> {
    const staff = await tx.user.findUnique({
        where: { id: input.staffUserId },
        select: { id: true, disabledAt: true },
    });
    if (!staff) throw new BindingConflictError('staff user does not exist');
    if (staff.disabledAt) throw new BindingConflictError('staff user is disabled');

    const [byStaff, byAccount] = await Promise.all([
        tx.staffAccountBinding.findUnique({ where: { staffUserId: input.staffUserId } }),
        tx.staffAccountBinding.findUnique({
            where: {
                accountIssuer_accountSubject: {
                    accountIssuer: input.accountIssuer,
                    accountSubject: input.accountSubject,
                },
            },
        }),
    ]);

    if (byStaff?.disabledAt || byAccount?.disabledAt) {
        throw new BindingConflictError('a matching staff binding is disabled and cannot be re-enabled by this utility');
    }
    if (byStaff && (byStaff.accountIssuer !== input.accountIssuer || byStaff.accountSubject !== input.accountSubject)) {
        throw new BindingConflictError('staff user is already bound to another Account identity');
    }
    if (byAccount && byAccount.staffUserId !== input.staffUserId) {
        throw new BindingConflictError('Account identity is already bound to another staff user');
    }
    if (byStaff && byAccount && byStaff.id === byAccount.id) {
        return { outcome: 'already-bound', bindingId: byStaff.id };
    }
    if (byStaff || byAccount) throw new BindingConflictError('inconsistent one-to-one staff binding state');
    return { outcome: 'would-create', bindingId: null };
}

export async function provisionStaffAccountBinding(
    prisma: PrismaClient,
    input: BindingInput,
    apply: boolean,
): Promise<BindingResult> {
    if (!apply) {
        return prisma.$transaction((tx) => inspectBinding(tx, input), {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            return await prisma.$transaction(async (tx) => {
                const inspected = await inspectBinding(tx, input);
                if (inspected.outcome === 'already-bound') return inspected;
                const binding = await tx.staffAccountBinding.create({
                    data: {
                        accountIssuer: input.accountIssuer,
                        accountSubject: input.accountSubject,
                        staffUserId: input.staffUserId,
                    },
                    select: { id: true },
                });
                await tx.auditLog.create({
                    data: {
                        actorUserId: null,
                        action: AUDIT_ACTION,
                        targetType: 'STAFF_ACCOUNT_BINDING',
                        targetId: binding.id,
                        reason: 'live_staging_operator_provision',
                        metadata: {
                            accountIssuer: input.accountIssuer,
                            source: 'root_one_shot_utility',
                        },
                    },
                });
                return { outcome: 'created', bindingId: binding.id };
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        } catch (error) {
            const retryable = error instanceof Prisma.PrismaClientKnownRequestError &&
                (error.code === 'P2002' || error.code === 'P2034');
            if (!retryable || attempt === 2) throw error;
        }
    }
    throw new Error('unreachable binding retry state');
}

async function assertDatabaseIdentity(prisma: PrismaClient): Promise<void> {
    const rows = await prisma.$queryRaw<Array<{ database_name: string }>>`
        SELECT current_database() AS database_name
    `;
    if (rows.length !== 1 || rows[0]?.database_name !== STAGING_DATABASE_NAME) {
        fail('connected database is not the isolated Live staging database');
    }
}

export async function main(
    argv = process.argv.slice(2),
    environment: Record<string, string | undefined> = process.env,
): Promise<void> {
    if (process.getuid?.() !== 0) fail('run as root');
    if (argv.length !== 1 || !['--dry-run', '--apply'].includes(argv[0] ?? '')) {
        fail('usage: bind-staff-account.ts (--dry-run|--apply)');
    }
    const databaseUrl = validateStagingEnvironment(environment);
    const input = await readRootOnlyBindingInput();
    const pool = new Pool({ connectionString: databaseUrl.toString(), max: 2 });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    try {
        await assertDatabaseIdentity(prisma);
        const result = await provisionStaffAccountBinding(prisma, input, argv[0] === '--apply');
        const subjectDigest = createHash('sha256').update(input.accountSubject).digest('hex').slice(0, 12);
        process.stdout.write(JSON.stringify({
            mode: argv[0] === '--apply' ? 'apply' : 'dry-run',
            outcome: result.outcome,
            staffUserId: input.staffUserId,
            subjectDigest,
        }) + '\n');
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        process.stderr.write(`Live staging staff binding failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
        process.exitCode = 1;
    });
}
