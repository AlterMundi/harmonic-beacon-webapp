import { describe, expect, it, vi } from 'vitest';

import { applyAuthorizedScheduleOperation, parseScheduleRequest } from '../authorized-schedule-operation';

const REQUEST = {
  schemaVersion: 'harmonic-beacon.schedule-operation.v1',
  scope: 'synthetic-rehearsal',
  requestId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  actorUserId: '33333333-3333-4333-8333-333333333333',
  expectedScheduledAt: '2026-09-10T20:00:00.000Z',
  scheduledAt: '2026-09-10T21:00:00.000Z',
  reason: 'Authorized correction for published event schedule',
};

function store(scheduledAt = REQUEST.expectedScheduledAt, role = 'ADMIN', synthetic = true) {
  const update = vi.fn(async () => true);
  const audit = vi.fn(async () => undefined);
  return {
    findActor: vi.fn(async () => ({ id: REQUEST.actorUserId, role, disabledAt: null })),
    findSession: vi.fn(async () => ({
      id: REQUEST.sessionId,
      scheduledAt: new Date(scheduledAt),
      isTest: synthetic,
      publicAccess: false,
      status: 'SCHEDULED',
      roomName: 'ops-e-rehearsal-schedule',
    })),
    update,
    audit,
  };
}

describe('authorized schedule operation', () => {
  it('rejects malformed, unbounded, and free-form operation requests', () => {
    expect(() => parseScheduleRequest({ ...REQUEST, scheduledAt: 'tomorrow' })).toThrow(/scheduledAt/);
    expect(() => parseScheduleRequest({ ...REQUEST, reason: 'x' })).toThrow(/reason/);
    expect(() => parseScheduleRequest({ ...REQUEST, sql: 'UPDATE scheduled_sessions' })).toThrow(/unknown/);
  });

  it('requires an enabled ADMIN actor and exact current schedule compare-and-set', async () => {
    await expect(applyAuthorizedScheduleOperation(store(undefined, 'OPERATOR'), REQUEST)).rejects.toThrow(/ADMIN/);
    await expect(applyAuthorizedScheduleOperation(store('2026-09-10T19:00:00.000Z'), REQUEST)).rejects.toThrow(/stale/);
  });

  it('fails a concurrent compare-and-set without writing an audit record', async () => {
    const adapter = store();
    adapter.update.mockResolvedValue(false);
    await expect(applyAuthorizedScheduleOperation(adapter, REQUEST)).rejects.toThrow(/stale/);
    expect(adapter.audit).not.toHaveBeenCalled();
  });

  it('rehearses only against an isolated non-public synthetic session', async () => {
    await expect(applyAuthorizedScheduleOperation(store(undefined, 'ADMIN', false), REQUEST)).rejects.toThrow(/synthetic/);
    const exposed = store();
    exposed.findSession.mockResolvedValue({
      id: REQUEST.sessionId,
      scheduledAt: new Date(REQUEST.expectedScheduledAt),
      isTest: true,
      publicAccess: true,
      status: 'SCHEDULED',
      roomName: 'ops-e-rehearsal-schedule',
    });
    await expect(applyAuthorizedScheduleOperation(exposed, REQUEST)).rejects.toThrow(/non-public/);
  });

  it('updates once and writes an audit entry bound to request and before/after values', async () => {
    const adapter = store();
    const result = await applyAuthorizedScheduleOperation(adapter, REQUEST);
    expect(result).toEqual({ changed: true, requestId: REQUEST.requestId });
    expect(adapter.update).toHaveBeenCalledTimes(1);
    expect(adapter.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'SESSION_SCHEDULE_AUTHORIZED',
      targetId: REQUEST.sessionId,
      actorUserId: REQUEST.actorUserId,
      metadata: expect.objectContaining({
        requestId: REQUEST.requestId,
        before: REQUEST.expectedScheduledAt,
        after: REQUEST.scheduledAt,
      }),
    }));
  });

  it('is idempotent after success and never duplicates update or audit effects', async () => {
    const adapter = store(REQUEST.scheduledAt);
    const result = await applyAuthorizedScheduleOperation(adapter, REQUEST);
    expect(result).toEqual({ changed: false, requestId: REQUEST.requestId });
    expect(adapter.update).not.toHaveBeenCalled();
    expect(adapter.audit).not.toHaveBeenCalled();
  });
});
