import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function productionTsxFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === '__tests__' || path.endsWith(join('app', 'test-login'))) return [];
            return productionTsxFiles(path);
        }
        return entry.name.endsWith('.tsx') && !entry.name.includes('.test.') ? [path] : [];
    });
}

const surfaceFiles = [
    ...productionTsxFiles(join(ROOT, 'src', 'app')),
    ...productionTsxFiles(join(ROOT, 'src', 'components')),
];

describe('professional surface legibility contract', () => {
    it('keeps sub-12px utility text limited to explicitly decorative marks', () => {
        const occurrences = surfaceFiles.flatMap((file) => {
            const source = readFileSync(file, 'utf8');
            return source.split('\n').flatMap((line) =>
                /text-\[(?:9|10|11)px\]/.test(line)
                    ? [`${relative(ROOT, file)}: ${line.trim()}`]
                    : [],
            );
        });

        expect(occurrences).toEqual([
            'src/app/ops/events/[id]/page.tsx: <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-[var(--gold)]">404</p>',
            'src/app/page.tsx: <p className="flex items-center gap-2.5 text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]">',
        ]);
    });

    it('keeps shared functional controls and metadata at 12px or larger', () => {
        const css = readFileSync(join(ROOT, 'src', 'app', 'globals.css'), 'utf8');
        for (const selector of [
            '.event-button',
            '.status-pill',
            '.mono-meta',
            '.live-badge',
            '.lang-control__button',
        ]) {
            const block = css.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`))?.[1];
            expect(block, `${selector} is missing`).toBeDefined();
            const fontSize = Number(block?.match(/font-size:\s*(\d+)px/)?.[1]);
            expect(fontSize, `${selector} is below 12px`).toBeGreaterThanOrEqual(12);
        }
    });

    it('does not hide essential surface copy behind truncation or a stale panel alias', () => {
        const renderedSource = surfaceFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
        const css = readFileSync(join(ROOT, 'src', 'app', 'globals.css'), 'utf8');

        expect(renderedSource).not.toMatch(/(?:^|\s)(?:truncate|line-clamp-\d+)(?:\s|$)/);
        expect(css).not.toContain('.operator-panel');
    });
});
