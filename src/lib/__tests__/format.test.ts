import { describe, it, expect } from 'vitest';
import { getGradient, formatDuration, formatTime, formatTimeMs, formatDate } from '../format';

describe('getGradient', () => {
    it('returns a valid gradient class string', () => {
        const result = getGradient('abc123');
        expect(result).toMatch(/^from-\w+-\d+ to-\w+-\d+$/);
    });

    it('is deterministic (same ID → same gradient)', () => {
        expect(getGradient('meditation-1')).toBe(getGradient('meditation-1'));
        expect(getGradient('test-xyz')).toBe(getGradient('test-xyz'));
    });

    it('varies for different IDs', () => {
        const results = new Set(
            ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map(getGradient)
        );
        expect(results.size).toBeGreaterThan(1);
    });

    it('handles empty string', () => {
        const result = getGradient('');
        expect(result).toMatch(/^from-/);
    });

    it('always returns one of the 8 gradients', () => {
        const validGradients = [
            "from-purple-600 to-blue-600",
            "from-indigo-600 to-purple-800",
            "from-rose-500 to-pink-600",
            "from-emerald-600 to-teal-600",
            "from-amber-500 to-orange-600",
            "from-cyan-500 to-blue-600",
            "from-fuchsia-600 to-purple-600",
            "from-violet-600 to-indigo-600",
        ];
        for (let i = 0; i < 50; i++) {
            expect(validGradients).toContain(getGradient(`id-${i}`));
        }
    });
});

describe('formatDuration', () => {
    it('formats 0 seconds as 0:00', () => {
        expect(formatDuration(0)).toBe('0:00');
    });

    it('formats seconds only', () => {
        expect(formatDuration(5)).toBe('0:05');
        expect(formatDuration(30)).toBe('0:30');
    });

    it('formats full minutes', () => {
        expect(formatDuration(60)).toBe('1:00');
        expect(formatDuration(120)).toBe('2:00');
    });

    it('formats minutes and seconds', () => {
        expect(formatDuration(125)).toBe('2:05');
        expect(formatDuration(90)).toBe('1:30');
    });

    it('formats large values', () => {
        expect(formatDuration(3661)).toBe('61:01');
    });

    it('pads seconds with leading zero', () => {
        expect(formatDuration(61)).toBe('1:01');
        expect(formatDuration(9)).toBe('0:09');
    });
});

describe('formatTime', () => {
    it('formats 0 as 00:00', () => {
        expect(formatTime(0)).toBe('00:00');
    });

    it('pads both minutes and seconds', () => {
        expect(formatTime(5)).toBe('00:05');
        expect(formatTime(65)).toBe('01:05');
    });

    it('formats large values', () => {
        expect(formatTime(600)).toBe('10:00');
        expect(formatTime(3599)).toBe('59:59');
    });
});

describe('formatTimeMs', () => {
    it('converts milliseconds to M:SS', () => {
        expect(formatTimeMs(0)).toBe('0:00');
        expect(formatTimeMs(1000)).toBe('0:01');
        expect(formatTimeMs(60000)).toBe('1:00');
        expect(formatTimeMs(125000)).toBe('2:05');
    });

    it('floors fractional seconds', () => {
        expect(formatTimeMs(1500)).toBe('0:01');
        expect(formatTimeMs(999)).toBe('0:00');
    });
});

describe('formatDate', () => {
    it('returns "Today" for today\'s date', () => {
        const now = new Date().toISOString();
        expect(formatDate(now)).toBe('Today');
    });

    it('returns "Yesterday" for yesterday\'s date', () => {
        const yesterday = new Date(Date.now() - 86400000).toISOString();
        expect(formatDate(yesterday)).toBe('Yesterday');
    });

    it('returns short date for older dates', () => {
        const old = new Date('2024-01-15T12:00:00Z').toISOString();
        const result = formatDate(old);
        expect(result).toContain('Jan');
        expect(result).toContain('15');
    });

    it('returns short date for 3 days ago', () => {
        const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
        const result = formatDate(threeDaysAgo);
        expect(result).not.toBe('Today');
        expect(result).not.toBe('Yesterday');
    });
});
