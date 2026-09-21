const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const KEYS = ['actorUserId', 'expectedScheduledAt', 'reason', 'requestId', 'scheduledAt', 'schemaVersion', 'scope', 'sessionId'];

export type ScheduleRequest = {
  schemaVersion: 'harmonic-beacon.schedule-operation.v1';
  scope: 'synthetic-rehearsal';
  requestId: string;
  sessionId: string;
  actorUserId: string;
  expectedScheduledAt: string;
  scheduledAt: string;
  reason: string;
};

export type ScheduleAdapter = {
  findActor: (id: string) => Promise<{ id: string; role: string; disabledAt: Date | null } | null>;
  findSession: (id: string) => Promise<{
    id: string;
    scheduledAt: Date;
    isTest: boolean;
    publicAccess: boolean;
    status: string;
    roomName: string;
  } | null>;
  update: (input: { sessionId: string; expectedScheduledAt: Date; scheduledAt: Date }) => Promise<boolean>;
  audit: (input: {
    actorUserId: string;
    actorRole: 'ADMIN';
    action: 'SESSION_SCHEDULE_AUTHORIZED';
    targetType: 'ScheduledSession';
    targetId: string;
    reason: string;
    metadata: { requestId: string; before: string; after: string };
  }) => Promise<unknown>;
};

function exactIso(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    throw new Error(`${field} must be an exact UTC timestamp`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== value) throw new Error(`${field} is invalid`);
  return value;
}

export function parseScheduleRequest(value: unknown): ScheduleRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('request must be an object');
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort();
  if (JSON.stringify(keys) !== JSON.stringify(KEYS)) throw new Error('request contains missing or unknown fields');
  if (input.schemaVersion !== 'harmonic-beacon.schedule-operation.v1') throw new Error('unsupported schedule request');
  if (input.scope !== 'synthetic-rehearsal') throw new Error('only synthetic rehearsal operations are accepted');
  for (const field of ['requestId', 'sessionId', 'actorUserId'] as const) {
    if (typeof input[field] !== 'string' || !UUID.test(input[field])) throw new Error(`${field} must be a UUID`);
  }
  const reason = input.reason;
  if (typeof reason !== 'string' || reason.length < 16 || reason.length > 240 || reason.trim() !== reason || /[\r\n]/u.test(reason)) {
    throw new Error('reason must be a bounded single line');
  }
  return {
    schemaVersion: input.schemaVersion,
    scope: input.scope,
    requestId: input.requestId as string,
    sessionId: input.sessionId as string,
    actorUserId: input.actorUserId as string,
    expectedScheduledAt: exactIso(input.expectedScheduledAt, 'expectedScheduledAt'),
    scheduledAt: exactIso(input.scheduledAt, 'scheduledAt'),
    reason,
  };
}

export async function applyAuthorizedScheduleOperation(adapter: ScheduleAdapter, raw: unknown): Promise<{ changed: boolean; requestId: string }> {
  const request = parseScheduleRequest(raw);
  const actor = await adapter.findActor(request.actorUserId);
  if (!actor || actor.disabledAt || actor.role !== 'ADMIN') throw new Error('an enabled ADMIN actor is required');
  const session = await adapter.findSession(request.sessionId);
  if (!session) throw new Error('scheduled session does not exist');
  if (!session.isTest || session.status !== 'SCHEDULED' || !session.roomName.startsWith('ops-e-rehearsal-')) {
    throw new Error('schedule rehearsal requires an isolated synthetic scheduled session');
  }
  if (session.publicAccess) throw new Error('schedule rehearsal requires a non-public session');
  const current = session.scheduledAt.toISOString();
  if (current === request.scheduledAt) return { changed: false, requestId: request.requestId };
  if (current !== request.expectedScheduledAt) throw new Error('schedule request is stale');
  const changed = await adapter.update({
    sessionId: request.sessionId,
    expectedScheduledAt: new Date(request.expectedScheduledAt),
    scheduledAt: new Date(request.scheduledAt),
  });
  if (!changed) throw new Error('schedule request is stale after concurrent update');
  await adapter.audit({
    actorUserId: request.actorUserId,
    actorRole: 'ADMIN',
    action: 'SESSION_SCHEDULE_AUTHORIZED',
    targetType: 'ScheduledSession',
    targetId: request.sessionId,
    reason: request.reason,
    metadata: { requestId: request.requestId, before: current, after: request.scheduledAt },
  });
  return { changed: true, requestId: request.requestId };
}
