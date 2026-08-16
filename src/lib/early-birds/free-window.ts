import type { EarlyBirdFreeSchedule } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';

export const EARLY_BIRD_FREE_WINDOW_DURATION_MS = 2 * 60 * 60 * 1000;
export const EARLY_BIRD_FREE_WINDOW_CHANGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

type LocalDate = { year: number; month: number; day: number };
type ZonedParts = LocalDate & { hour: number; minute: number };
const formatterCache = new Map<string, Intl.DateTimeFormat>();
const windowCache = new Map<string, { startMs: number; endMs: number }>();
const MAX_WINDOW_CACHE_ENTRIES = 20_000;

export type EarlyBirdFreeWindowState = {
    configured: boolean;
    active: boolean;
    timeZone: string | null;
    localStartMinute: number | null;
    selectedAt: Date | null;
    changeAllowedAt: Date | null;
    canChange: boolean;
    activeStart: Date | null;
    activeEnd: Date | null;
    nextStart: Date | null;
    nextEnd: Date | null;
};

export class EarlyBirdFreeWindowCooldownError extends Error {
    constructor(readonly changeAllowedAt: Date) {
        super('The Free listening window is locked for seven days');
        this.name = 'EarlyBirdFreeWindowCooldownError';
    }
}

export class EarlyBirdFreeWindowInputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'EarlyBirdFreeWindowInputError';
    }
}

function dateTimeFormatter(timeZone: string, includeOffset = false): Intl.DateTimeFormat {
    const key = `${timeZone}:${includeOffset ? 'offset' : 'wall'}`;
    const cached = formatterCache.get(key);
    if (cached) return cached;
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
        ...(includeOffset ? { timeZoneName: 'shortOffset' } : {}),
    });
    formatterCache.set(key, formatter);
    return formatter;
}

export function canonicalIanaTimeZone(value: unknown): string {
    if (typeof value !== 'string' || value.length < 1 || value.length > 64) {
        throw new EarlyBirdFreeWindowInputError('timeZone must be a valid IANA time zone');
    }
    try {
        return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
    } catch {
        throw new EarlyBirdFreeWindowInputError('timeZone must be a valid IANA time zone');
    }
}

function numericPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
    const value = Number(parts.find((part) => part.type === type)?.value);
    if (!Number.isInteger(value)) throw new Error(`Unable to resolve ${type} for time zone`);
    return value;
}

export function zonedParts(instant: Date, timeZone: string): ZonedParts {
    const parts = dateTimeFormatter(timeZone).formatToParts(instant);
    return {
        year: numericPart(parts, 'year'),
        month: numericPart(parts, 'month'),
        day: numericPart(parts, 'day'),
        hour: numericPart(parts, 'hour'),
        minute: numericPart(parts, 'minute'),
    };
}

function offsetMinutesAt(instant: Date, timeZone: string): number {
    const name = dateTimeFormatter(timeZone, true)
        .formatToParts(instant)
        .find((part) => part.type === 'timeZoneName')?.value;
    if (name === 'GMT' || name === 'UTC') return 0;
    const match = name?.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
    if (!match) throw new Error(`Unable to resolve offset for ${timeZone}`);
    const magnitude = Number(match[2]) * 60 + Number(match[3] ?? 0);
    return match[1] === '-' ? -magnitude : magnitude;
}

function addLocalDays(date: LocalDate, days: number): LocalDate {
    const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
    return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
    };
}

function sameWallMinute(parts: ZonedParts, target: ZonedParts): boolean {
    return parts.year === target.year
        && parts.month === target.month
        && parts.day === target.day
        && parts.hour === target.hour
        && parts.minute === target.minute;
}

/**
 * Resolve a local wall-clock minute without relying on the host time zone.
 * Ambiguous fall-back times choose the first occurrence. A spring-forward
 * gap advances to the first real local minute after the requested time.
 */
export function wallClockInstant(
    date: LocalDate,
    localStartMinute: number,
    timeZone: string,
): Date {
    if (!Number.isInteger(localStartMinute) || localStartMinute < 0 || localStartMinute >= 1440) {
        throw new EarlyBirdFreeWindowInputError('localStartMinute must be between 0 and 1439');
    }
    const baseWallMs = Date.UTC(date.year, date.month - 1, date.day, 0, localStartMinute);
    const offsets = new Set<number>();
    for (let sample = -8; sample <= 8; sample += 1) {
        offsets.add(offsetMinutesAt(new Date(baseWallMs + sample * 6 * 60 * 60 * 1000), timeZone));
    }

    // Most dates resolve on the first iteration. The bounded scan also gives
    // deterministic behavior for rare political offset jumps and skipped days.
    for (let shiftedMinute = 0; shiftedMinute <= 1440; shiftedMinute += 1) {
        const targetWallMs = baseWallMs + shiftedMinute * 60 * 1000;
        const targetDate = new Date(targetWallMs);
        const target: ZonedParts = {
            year: targetDate.getUTCFullYear(),
            month: targetDate.getUTCMonth() + 1,
            day: targetDate.getUTCDate(),
            hour: targetDate.getUTCHours(),
            minute: targetDate.getUTCMinutes(),
        };
        const candidates = [...offsets]
            .map((offset) => new Date(targetWallMs - offset * 60 * 1000))
            .filter((candidate) => sameWallMinute(zonedParts(candidate, timeZone), target))
            .sort((left, right) => left.getTime() - right.getTime());
        if (candidates[0]) return candidates[0];
    }
    throw new Error(`Unable to resolve local Free window in ${timeZone}`);
}

function windowForDate(
    date: LocalDate,
    schedule: Pick<EarlyBirdFreeSchedule, 'localStartMinute' | 'timeZone'>,
): { start: Date; end: Date } {
    const key = `${schedule.timeZone}:${schedule.localStartMinute}:${date.year}-${date.month}-${date.day}`;
    const cached = windowCache.get(key);
    if (cached) return { start: new Date(cached.startMs), end: new Date(cached.endMs) };
    const start = wallClockInstant(date, schedule.localStartMinute, schedule.timeZone);
    const end = new Date(start.getTime() + EARLY_BIRD_FREE_WINDOW_DURATION_MS);
    if (windowCache.size >= MAX_WINDOW_CACHE_ENTRIES) windowCache.clear();
    windowCache.set(key, { startMs: start.getTime(), endMs: end.getTime() });
    return { start, end };
}

export function freeWindowState(
    schedule: EarlyBirdFreeSchedule | null,
    now = new Date(),
): EarlyBirdFreeWindowState {
    if (!schedule) {
        return {
            configured: false,
            active: false,
            timeZone: null,
            localStartMinute: null,
            selectedAt: null,
            changeAllowedAt: null,
            canChange: true,
            activeStart: null,
            activeEnd: null,
            nextStart: null,
            nextEnd: null,
        };
    }

    const todayParts = zonedParts(now, schedule.timeZone);
    const today = { year: todayParts.year, month: todayParts.month, day: todayParts.day };
    const candidates = [
        windowForDate(addLocalDays(today, -1), schedule),
        windowForDate(today, schedule),
    ];
    const activeWindow = candidates
        .filter(({ start, end }) => start <= now && now < end)
        .sort((left, right) => right.start.getTime() - left.start.getTime())[0] ?? null;
    const todayWindow = candidates[1];
    const nextWindow = todayWindow.start > now
        ? todayWindow
        : windowForDate(addLocalDays(today, 1), schedule);

    return {
        configured: true,
        active: activeWindow !== null,
        timeZone: schedule.timeZone,
        localStartMinute: schedule.localStartMinute,
        selectedAt: schedule.selectedAt,
        changeAllowedAt: schedule.changeAllowedAt,
        canChange: schedule.changeAllowedAt <= now,
        activeStart: activeWindow?.start ?? null,
        activeEnd: activeWindow?.end ?? null,
        nextStart: nextWindow.start,
        nextEnd: nextWindow.end,
    };
}

export async function getEarlyBirdFreeWindow(
    accountId: string,
    now = new Date(),
): Promise<{ schedule: EarlyBirdFreeSchedule | null; state: EarlyBirdFreeWindowState }> {
    const schedule = await prisma.earlyBirdFreeSchedule.findUnique({ where: { accountId } });
    return { schedule, state: freeWindowState(schedule, now) };
}

export async function selectEarlyBirdFreeWindow(input: {
    accountId: string;
    mode: 'now' | 'custom';
    timeZone: string;
    localStartMinute?: number;
    selectionRequestId: string;
    now?: Date;
}): Promise<{ schedule: EarlyBirdFreeSchedule; state: EarlyBirdFreeWindowState; replayed: boolean }> {
    const now = input.now ?? new Date();
    const timeZone = canonicalIanaTimeZone(input.timeZone);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(input.selectionRequestId)) {
        throw new EarlyBirdFreeWindowInputError('selectionRequestId must be a UUID');
    }
    const requestedMinute = input.mode === 'now'
        ? null
        : input.localStartMinute;
    if (input.mode === 'custom' && (
        !Number.isInteger(requestedMinute)
        || requestedMinute! < 0
        || requestedMinute! >= 1440
    )) {
        throw new EarlyBirdFreeWindowInputError('localStartMinute must be between 0 and 1439');
    }

    const outcome = await prisma.$transaction(async (tx) => {
        const accounts = await tx.$queryRaw<Array<{ id: string }>>(
            Prisma.sql`SELECT "id" FROM "early_bird_users" WHERE "id" = ${input.accountId} FOR UPDATE`,
        );
        if (accounts.length !== 1) throw new EarlyBirdFreeWindowInputError('Listener account does not exist');

        const existing = await tx.earlyBirdFreeSchedule.findUnique({ where: { accountId: input.accountId } });
        if (existing?.selectionRequestId === input.selectionRequestId) {
            return { schedule: existing, replayed: true };
        }
        if (existing && existing.changeAllowedAt > now) {
            throw new EarlyBirdFreeWindowCooldownError(existing.changeAllowedAt);
        }

        const localStartMinute = input.mode === 'now'
            ? (() => {
                const local = zonedParts(now, timeZone);
                return local.hour * 60 + local.minute;
            })()
            : requestedMinute!;
        const changeAllowedAt = new Date(now.getTime() + EARLY_BIRD_FREE_WINDOW_CHANGE_COOLDOWN_MS);
        const data = {
            timeZone,
            localStartMinute,
            selectedAt: now,
            changeAllowedAt,
            selectionRequestId: input.selectionRequestId,
            revision: (existing?.revision ?? 0) + 1,
        };
        const schedule = existing
            ? await tx.earlyBirdFreeSchedule.update({ where: { accountId: input.accountId }, data })
            : await tx.earlyBirdFreeSchedule.create({ data: { accountId: input.accountId, ...data } });

        // A changed schedule may move the authorization boundary immediately.
        // Force every device to obtain a grant checked against the new window.
        if (existing) {
            await tx.earlyBirdStreamLease.updateMany({
                where: { accountId: input.accountId, evictedAt: null },
                data: { evictedAt: now },
            });
        }
        return { schedule, replayed: false };
    });
    return { ...outcome, state: freeWindowState(outcome.schedule, now) };
}

export function serializeFreeWindowState(state: EarlyBirdFreeWindowState) {
    return {
        ...state,
        selectedAt: state.selectedAt?.toISOString() ?? null,
        changeAllowedAt: state.changeAllowedAt?.toISOString() ?? null,
        activeStart: state.activeStart?.toISOString() ?? null,
        activeEnd: state.activeEnd?.toISOString() ?? null,
        nextStart: state.nextStart?.toISOString() ?? null,
        nextEnd: state.nextEnd?.toISOString() ?? null,
    };
}

export type SerializedEarlyBirdFreeWindowState = ReturnType<typeof serializeFreeWindowState>;
