import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const CONTRACT = path.resolve('contracts/amplification-credit-entries/v1');

describe('amplification credit shared contract bytes', () => {
    it('keeps every copyable contract artifact covered by SHA256SUMS', () => {
        const manifest = readFileSync(path.join(CONTRACT, 'SHA256SUMS'), 'utf8').trim().split('\n');
        expect(manifest).toHaveLength(4);
        for (const line of manifest) {
            const [expected, filename] = line.split('  ', 2);
            const bytes = readFileSync(path.join(CONTRACT, filename));
            expect(createHash('sha256').update(bytes).digest('hex'), filename).toBe(expected);
        }
    });

    it('ships paid, free-nullable and durable empty-poll synthetic fixtures', () => {
        const page = JSON.parse(readFileSync(path.join(CONTRACT, 'page.fixture.json'), 'utf8'));
        const empty = JSON.parse(readFileSync(path.join(CONTRACT, 'empty-page.fixture.json'), 'utf8'));
        expect(page.schema_version).toBe('amplification-credit-entries.v1');
        expect(page.entries).toHaveLength(2);
        expect(page.entries[0].registration_id).toMatch(/^[0-9a-f-]{36}$/);
        expect(page.entries[1]).toMatchObject({
            registration_id: null,
            email: null,
            display_name: null,
        });
        expect(empty).toEqual({
            schema_version: 'amplification-credit-entries.v1',
            entries: [],
            next_cursor: page.next_cursor,
        });
    });
});
