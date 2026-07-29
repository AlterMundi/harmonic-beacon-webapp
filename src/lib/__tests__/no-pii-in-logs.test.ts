import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Guards the PRODUCT_PRINCIPLES.md rule "No logging PII to anywhere we can't
 * purge" as an invariant rather than a sentence in a document.
 *
 * The motivating regression: auth-config.ts logged `email=${token.email}` on
 * every JWT sync. Container stdout is shipped off-host and cannot be purged
 * per-user, so that line put an email address permanently beyond reach of a
 * deletion request. TECH_AUDIT.md T5 flagged it; this keeps it from returning.
 *
 * Deliberately a source scan and not a runtime assertion: the leak is a shape of
 * code, and there is no single chokepoint to instrument — every `console.*` call
 * in the codebase is a candidate site.
 */

const SRC = join(process.cwd(), 'src');

/** Property reads that carry personal data straight into a log. */
const PII_ACCESSORS = [
    '.email',
    '.name',
    '.avatarUrl',
    '.picture',
    '.image',
];

function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === '__tests__' || entry === 'node_modules') continue;
            sourceFiles(full, acc);
        } else if (/\.tsx?$/.test(entry)) {
            acc.push(full);
        }
    }
    return acc;
}

/**
 * Extract the argument text of every `console.*(...)` call, tracking parenthesis
 * depth so nested calls and multi-line arguments come out whole.
 */
function consoleCallArgs(source: string): { text: string; line: number }[] {
    const calls: { text: string; line: number }[] = [];
    const re = /console\.(log|error|warn|info|debug)\s*\(/g;
    let match: RegExpExecArray | null;

    while ((match = re.exec(source)) !== null) {
        let depth = 1;
        let i = match.index + match[0].length;
        const start = i;
        while (i < source.length && depth > 0) {
            const ch = source[i];
            if (ch === '(') depth++;
            else if (ch === ')') depth--;
            i++;
        }
        calls.push({
            text: source.slice(start, i - 1),
            line: source.slice(0, match.index).split('\n').length,
        });
    }
    return calls;
}

describe('no PII in logs', () => {
    const files = sourceFiles(SRC);

    it('scans a plausible number of source files', () => {
        // Guards the guard: a broken walker would silently pass everything.
        // Floor lowered after the WS0 strip reduced the app to its launch surfaces.
        expect(files.length).toBeGreaterThan(20);
    });

    it('no console call reads a PII-bearing property', () => {
        const violations: string[] = [];

        for (const file of files) {
            const source = readFileSync(file, 'utf8');
            for (const call of consoleCallArgs(source)) {
                for (const accessor of PII_ACCESSORS) {
                    if (call.text.includes(accessor)) {
                        violations.push(
                            `${file.replace(process.cwd() + '/', '')}:${call.line} logs "${accessor}" — ${call.text.trim().slice(0, 80)}`,
                        );
                    }
                }
            }
        }

        expect(violations).toEqual([]);
    });

    it('detects a violation when one exists', () => {
        // Proves the matcher works, so a green run means something.
        const sample = 'console.log(`sync sub=${token.sub} email=${token.email}`);';
        const found = consoleCallArgs(sample).some((c) =>
            PII_ACCESSORS.some((a) => c.text.includes(a)),
        );
        expect(found).toBe(true);
    });

    it('does not flag a log that merely mentions the word email', () => {
        const sample = "console.log('receipt email dispatched');";
        const found = consoleCallArgs(sample).some((c) =>
            PII_ACCESSORS.some((a) => c.text.includes(a)),
        );
        expect(found).toBe(false);
    });
});
