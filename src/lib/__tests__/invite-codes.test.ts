import { describe, it, expect } from 'vitest';
import { generateInviteCode, generateRoomName } from '../invite-codes';

describe('generateInviteCode', () => {
    it('returns a 12-character string', () => {
        const code = generateInviteCode();
        expect(code).toHaveLength(12);
    });

    it('contains only base64url characters', () => {
        const code = generateInviteCode();
        expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('generates unique codes across 100 calls', () => {
        const codes = new Set(Array.from({ length: 100 }, () => generateInviteCode()));
        expect(codes.size).toBe(100);
    });

    it('returns a string type', () => {
        expect(typeof generateInviteCode()).toBe('string');
    });
});

describe('generateRoomName', () => {
    it('returns format session-{8hexchars}', () => {
        const name = generateRoomName();
        expect(name).toMatch(/^session-[0-9a-f]{8}$/);
    });

    it('has total length of 16 characters', () => {
        const name = generateRoomName();
        expect(name).toHaveLength(16);
    });

    it('suffix contains only hex characters', () => {
        const name = generateRoomName();
        const suffix = name.replace('session-', '');
        expect(suffix).toMatch(/^[0-9a-f]+$/);
    });

    it('generates unique room names across 100 calls', () => {
        const names = new Set(Array.from({ length: 100 }, () => generateRoomName()));
        expect(names.size).toBe(100);
    });
});
