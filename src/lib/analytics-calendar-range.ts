const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function calendarOrdinal(value: string): number {
    const match = CALENDAR_DAY.exec(value);
    if (!match) throw new Error('invalid_calendar_day');
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const ordinal = Date.UTC(year, month - 1, day);
    const parsed = new Date(ordinal);
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
        throw new Error('invalid_calendar_day');
    }
    return ordinal;
}

export function shiftCalendarDay(value: string, amount: number): string {
    return new Date(calendarOrdinal(value) + amount * DAY_MS).toISOString().slice(0, 10);
}

export function calendarDayInTimeZone(instant: Date, timezone: string): string {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(instant).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
}

export function previousCalendarRange(start: string, end: string): { start: string; end: string } {
    const startOrdinal = calendarOrdinal(start);
    const endOrdinal = calendarOrdinal(end);
    const selectedDays = Math.round((endOrdinal - startOrdinal) / DAY_MS) + 1;
    if (selectedDays < 1 || selectedDays > 2 * 366) throw new Error('invalid_calendar_range');
    return {
        start: shiftCalendarDay(start, -selectedDays),
        end: shiftCalendarDay(start, -1),
    };
}

export function validateAnalyticsTimezone(timezone: string): void {
    if (!timezone || timezone.length > 64) throw new Error('invalid_timezone');
    try {
        new Intl.DateTimeFormat('en', { timeZone: timezone }).format(new Date(0));
    } catch {
        throw new Error('invalid_timezone');
    }
}

export function validateAnalyticsCalendarSelection(start: string, end: string, timezone: string): void {
    previousCalendarRange(start, end);
    validateAnalyticsTimezone(timezone);
}
