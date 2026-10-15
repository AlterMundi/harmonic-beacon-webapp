/** Root-only local operator interface; input/output files never carry secrets to logs. */
import { readFile } from 'node:fs/promises';
import { prisma } from '../src/lib/db';
import { OPERATOR_PASSWORD, provisionOperator, issueOperatorCredential, revokeOperatorCredential,
    resolveOperatorAuthorization } from '../src/lib/operator-credentials';
import { createRootOutput, requireRootPath } from '../src/lib/operator-runtime';
import { transitionScheduledSession } from '../src/lib/session-lifecycle';
import { terminateSessionMedia } from '../src/lib/session-termination';

export type OperatorRequest = {
    environment: 'production' | 'staging';
    expectedSourceSha: string;
    operation: 'provision' | 'revoke' | 'close' | 'request';
    email?: string; name?: string; ttlHours?: number; tokenPath?: string;
    sessionId?: string; sessionIds?: string[]; reason?: string;
    method?: string; apiPath?: string; body?: unknown; responsePath?: string;
};

export function validateOperatorRequest(value: unknown, env: Record<string, string | undefined>) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Request object required');
    const r = value as OperatorRequest;
    const allowed = new Set(['environment','expectedSourceSha','operation','email','name','ttlHours','tokenPath',
        'sessionId','sessionIds','reason','method','apiPath','body','responsePath']);
    if (Object.keys(r).some(k => !allowed.has(k)) || !['production','staging'].includes(r.environment) ||
        !['provision','revoke','close','request'].includes(r.operation) ||
        !/^[a-f0-9]{40}$/.test(r.expectedSourceSha) || r.expectedSourceSha !== env.BEACON_GIT_SHA ||
        env.BEACON_OPERATOR_ENVIRONMENT !== r.environment) throw new Error('Exact operator environment/source required');
    const database = new URL(env.DATABASE_URL ?? '');
    if (!['postgres:','postgresql:'].includes(database.protocol) || database.pathname !== '/beacon') {
        throw new Error('Exact Beacon database required');
    }
    if (r.operation === 'close' && (!Array.isArray(r.sessionIds) || !r.sessionIds.length || r.sessionIds.length > 10 ||
        r.sessionIds.some(id => !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) ||
        typeof r.reason !== 'string' || !r.reason.trim() || r.reason.length > 240 || /[\x00-\x1f\x7f]/.test(r.reason))) {
        throw new Error('Explicit session IDs and bounded reason required');
    }
    if (r.operation === 'request' && (!['GET','POST','PATCH','PUT','DELETE'].includes(r.method ?? '') ||
        typeof r.apiPath !== 'string' || !/^\/api\/(ops|admin)(\/|$)/.test(r.apiPath) ||
        /[\\\x00-\x20\x7f]/.test(r.apiPath) || r.apiPath.includes('..') || r.apiPath.includes('%') ||
        !r.tokenPath || !r.responsePath)) throw new Error('Bounded Staff API request required');
    return r;
}

export async function closeOperatorSessions(r: OperatorRequest) {
    const actor = await prisma.user.findUniqueOrThrow({ where: { email: r.email } });
    const binding = await prisma.staffAccountBinding.findUnique({ where: { staffUserId: actor.id } });
    if (actor.passwordDigest !== OPERATOR_PASSWORD || binding || actor.disabledAt || actor.role !== 'ADMIN') {
        throw new Error('Enabled local machine administrator required');
    }
    const results = [];
    for (const sessionId of r.sessionIds!) {
        const before = await prisma.scheduledSession.findUniqueOrThrow({ where: { id: sessionId } });
        if (!['LIVE','ENDED'].includes(before.status)) throw new Error('Only LIVE closure or ENDED termination retry permitted');
        const result = await transitionScheduledSession({ sessionId, actor, targetStatus: 'ENDED', reason: r.reason });
        const termination = await terminateSessionMedia({ sessionId, actorUserId: actor.id, actorRole: actor.role });
        const after = await prisma.scheduledSession.findUniqueOrThrow({ where: { id: sessionId }, select: { status: true } });
        results.push({ sessionId, status: after.status, termination });
        if (result.status !== 'ENDED' || after.status !== 'ENDED' || !termination.complete) {
            throw new Error('Event closure incomplete; retry termination without reopening');
        }
    }
    return results;
}

export async function runOperator(r: OperatorRequest) {
    if (r.operation === 'provision') {
        if (!r.email || !r.name || !r.tokenPath) throw new Error('Operator identity and private token file required');
        const output = await createRootOutput(r.tokenPath);
        let issued: Awaited<ReturnType<typeof issueOperatorCredential>> | undefined;
        try {
            const user = await provisionOperator(r.email, r.name);
            issued = await issueOperatorCredential(user.id, r.ttlHours ?? 24);
            await output.writeFile(issued.token, 'utf8');
            await output.sync();
            return { operatorId: user.id, credentialId: issued.sessionId, expiresAt: issued.expiresAt };
        } catch (error) {
            if (issued) await revokeOperatorCredential(issued.sessionId);
            throw error;
        } finally { await output.close(); }
    }
    if (r.operation === 'revoke') {
        if (!r.sessionId) throw new Error('Credential ID required');
        await revokeOperatorCredential(r.sessionId);
        return { revoked: true };
    }
    if (r.operation === 'close') return closeOperatorSessions(r);
    await requireRootPath(r.tokenPath!);
    const token = (await readFile(r.tokenPath!, 'utf8')).trim();
    const operator = await resolveOperatorAuthorization(`Bearer ${token}`);
    if (!operator) throw new Error('Valid machine credential required');
    const origin = r.environment === 'production' ? 'https://live.harmonicbeacon.com' : 'https://live-staging.harmonicbeacon.com';
    const output = await createRootOutput(r.responsePath!);
    try {
        const response = await fetch(origin + r.apiPath, { method: r.method, redirect: 'error',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            ...(r.body === undefined ? {} : { body: JSON.stringify(r.body) }), signal: AbortSignal.timeout(30_000) });
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > 1_048_576) throw new Error('Operator response exceeds private output bound');
        await output.writeFile(Buffer.from(bytes)); await output.sync();
        return { status: response.status, ok: response.ok };
    } finally { await output.close(); }
}

async function main() {
    if (process.getuid?.() !== 0 || process.argv.length !== 3) throw new Error('Root and one private request file required');
    const file = process.argv[2];
    await requireRootPath(file);
    const raw = await readFile(file, 'utf8');
    if (Buffer.byteLength(raw) > 65_536) throw new Error('Operator request exceeds bound');
    const request = validateOperatorRequest(JSON.parse(raw), process.env);
    console.log(JSON.stringify(await runOperator(request)));
}

if (process.argv[1]?.endsWith('beacon-operator.ts') || process.argv[1]?.endsWith('beacon-operator.cjs')) {
    main().catch(() => { console.error('Beacon operator command failed; inspect private request and audit'); process.exitCode = 1; })
        .finally(() => prisma.$disconnect());
}
