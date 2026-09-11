import { describe, expect, it } from 'vitest';

import {
    calendarDayInTimeZone, previousCalendarRange, shiftCalendarDay, validateAnalyticsCalendarSelection,
} from '@/lib/analytics-calendar-range';

describe('analytics calendar ranges', () => {
    it('shifts calendar dates without inheriting the machine timezone', () => {
        expect(shiftCalendarDay('2026-03-01', -1)).toBe('2026-02-28');
        expect(shiftCalendarDay('2024-03-01', -1)).toBe('2024-02-29');
    });

    it('derives the visible calendar day in the selected IANA timezone', () => {
        const instant = new Date('2026-09-03T01:00:00Z');
        expect(calendarDayInTimeZone(instant, 'UTC')).toBe('2026-09-03');
        expect(calendarDayInTimeZone(instant, 'America/Argentina/Cordoba')).toBe('2026-09-02');
    });

    it('builds an equally sized, non-overlapping previous inclusive range', () => {
        expect(previousCalendarRange('2026-08-05', '2026-09-03')).toEqual({
            start: '2026-07-06', end: '2026-08-04',
        });
        expect(previousCalendarRange('2026-09-03', '2026-09-03')).toEqual({
            start: '2026-09-02', end: '2026-09-02',
        });
    });

    it('rejects impossible, reversed and oversized calendar ranges', () => {
        expect(() => previousCalendarRange('2026-02-30', '2026-03-01')).toThrow('invalid_calendar_day');
        expect(() => previousCalendarRange('2026-09-04', '2026-09-03')).toThrow('invalid_calendar_range');
        expect(() => previousCalendarRange('2024-01-01', '2026-01-02')).toThrow('invalid_calendar_range');
        expect(() => validateAnalyticsCalendarSelection('2026-09-03', '2026-09-03', 'Mars/Olympus')).toThrow('invalid_timezone');
    });
});
