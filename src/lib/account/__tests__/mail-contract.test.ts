import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), 'contracts/listener-account-mail/v1');

describe('Listener Account mail contract snapshot', () => {
    it('matches every byte committed by backend mail authority 988e710', () => {
        const manifest = readFileSync(resolve(root, 'SHA256SUMS'), 'utf8').trim().split('\n');
        expect(manifest).toContain(
            '2e92bb1edc526fa2cd2656b69b6bbf55c7be95f55d65c380c7e288f7efb69aee  email-change.schema.json',
        );
        expect(manifest).toContain(
            '3ab94cfb16e3c17ea54d695c445570455341a618fe2741a22cbd1d482c315448  fixtures/email-change.json',
        );
        for (const line of manifest) {
            const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
            expect(match).not.toBeNull();
            const [, expected, relative] = match!;
            const actual = createHash('sha256').update(readFileSync(resolve(root, relative))).digest('hex');
            expect(actual, relative).toBe(expected);
        }
    });
});
