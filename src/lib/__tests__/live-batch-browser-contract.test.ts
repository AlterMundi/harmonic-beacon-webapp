import { readFileSync } from 'node:fs';
import type { PlaywrightTestConfig } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import config, { managedServerCommand } from '../../../playwright.config';

const regressionFiles = [
    'e2e/tests/audio-activation.spec.ts',
    'e2e/tests/continuity-navigation.spec.ts',
];

function matches(pattern: string | RegExp | (string | RegExp)[] | undefined, value: string): boolean {
    if (pattern === undefined) return false;
    const entries = Array.isArray(pattern) ? pattern : [pattern];
    // Validate the entire array before any-match short-circuiting can hide a glob.
    // This contract deliberately supports only configured regexes, not globs.
    for (const entry of entries) {
        if (!(entry instanceof RegExp)) {
            throw new Error('Unsupported string/glob selection pattern: use RegExp in this browser contract');
        }
    }
    return entries.some((entry) => (entry as RegExp).test(value));
}

type SelectionFilters = Pick<PlaywrightTestConfig, 'testMatch' | 'testIgnore' | 'grep' | 'grepInvert'>;
const acceptanceTitle = 'live continuity without capture: preserves the active event';

// Shared by the real config contract and its in-memory negative controls.
function assertSelected(topLevel: SelectionFilters, project: SelectionFilters, file: string, title = acceptanceTitle): void {
    // Model the default test-file suffix for these repository-relative paths;
    // this is not a matcher for arbitrary configured globs.
    const testMatch = project.testMatch ?? topLevel.testMatch ?? /\.(spec|test)\.[cm]?[jt]sx?$/;
    const testIgnore = project.testIgnore ?? topLevel.testIgnore ?? [];
    const grep = project.grep ?? topLevel.grep ?? /.*/;
    const grepInvert = project.grepInvert ?? topLevel.grepInvert ?? [];
    expect(matches(testMatch, file), 'testMatch excludes acceptance').toBe(true);
    expect(matches(testIgnore, file), 'testIgnore excludes acceptance').toBe(false);
    expect(matches(grep, title), 'grep excludes acceptance').toBe(true);
    expect(matches(grepInvert, title), 'grepInvert excludes acceptance').toBe(false);
}

const inheritedExclusions: { field: keyof SelectionFilters; pattern: RegExp }[] = [
    { field: 'testMatch', pattern: /other-suite\.spec\.ts/ },
    { field: 'testIgnore', pattern: /audio-activation\.spec\.ts/ },
    { field: 'grep', pattern: /capture required/ },
    { field: 'grepInvert', pattern: /live continuity without capture/ },
];

describe('Browser selection contract negative controls', () => {
    const unsupportedPatterns = [
        { label: 'glob', pattern: '**/audio-activation.spec.ts' },
        { label: 'literal string', pattern: 'audio-activation' },
        { label: 'empty string', pattern: '' },
        { label: 'string array', pattern: ['**/audio-activation.spec.ts'] },
        { label: 'mixed array after a matching regex', pattern: [/.*/, '**/audio-activation.spec.ts'] },
    ];
    for (const { label, pattern } of unsupportedPatterns) {
        it(`explicitly rejects an unsupported ${label}`, () => {
            expect(() => matches(pattern, regressionFiles[0])).toThrow(/Unsupported string\/glob/);
        });
    }

    for (const field of ['testMatch', 'testIgnore'] as const) {
        for (const scope of ['top-level', 'project'] as const) {
            it(`rejects unsupported ${scope} ${field} globs rather than interpreting them as substrings`, () => {
                const filters = { [field]: '**/audio-activation.spec.ts' };
                expect(() => assertSelected(
                    scope === 'top-level' ? filters : {},
                    scope === 'project' ? filters : {},
                    regressionFiles[0],
                )).toThrow(/Unsupported string\/glob/);
            });
        }
    }

    it('supports regex arrays with any-match semantics', () => {
        expect(matches([/other-suite/, /audio-activation/], regressionFiles[0])).toBe(true);
        expect(matches([/other-suite/, /never/], regressionFiles[0])).toBe(false);
        expect(matches([], regressionFiles[0])).toBe(false);
    });

    for (const { field, pattern } of inheritedExclusions) {
        it(`rejects acceptance excluded by inherited ${field}`, () => {
            expect(() => assertSelected({ [field]: pattern }, {}, regressionFiles[0])).toThrow(field);
        });

        it(`honors a project override of inherited ${field}`, () => {
            const override = field === 'testMatch' || field === 'grep' ? [/.*/] : [];
            expect(() => assertSelected({ [field]: pattern }, { [field]: override }, regressionFiles[0])).not.toThrow();
        });
    }

    it('accepts regression files with Playwright defaults', () => {
        for (const file of regressionFiles) expect(() => assertSelected({}, {}, file)).not.toThrow();
    });

    it('rejects non-test files with Playwright default testMatch', () => {
        expect(() => assertSelected({}, {}, 'e2e/tests/helper.ts')).toThrow('testMatch');
    });
});

describe('Live continuity batch browser qualification', () => {
    it('builds by default and skips only the build when an earlier CI invocation owns it', () => {
        expect(managedServerCommand(3100, false)).toBe('npm run build && npx next start --port 3100');
        expect(managedServerCommand(3100, true)).toBe('npx next start --port 3100');
    });

    const desktopCases = [
        { file: 'e2e/tests/continuity-navigation-lifecycle.spec.ts', title: 'lifecycle: attendee native reload cancellation with real pointer activation retains its document' },
        { file: 'e2e/tests/navigation-media-probe.spec.ts', title: 'navigation capture probe retains interception after browser garbage collection' },
    ];
    for (const { file, title } of desktopCases) {
        for (const name of ['chromium', 'firefox']) {
            it(`selects the actual desktop lifecycle/probe title in ${file} on ${name}`, () => {
                const project = config.projects?.find((entry) => entry.name === name);
                expect(project).toBeDefined();
                assertSelected(config, project!, file, title);
                // The old generic no-capture title would incorrectly pass this exclusion.
                expect(() => assertSelected(config, { ...project, grep: /live continuity without capture/ }, file, title)).toThrow('grep');
            });
        }
        for (const name of ['android-chrome', 'iphone-webkit']) {
            it(`does not broaden ${name} into desktop-only ${file}`, () => {
                const project = config.projects?.find((entry) => entry.name === name);
                expect(project).toBeDefined();
                expect(() => assertSelected(config, project!, file, title)).toThrow('testMatch');
            });
        }
    }

    for (const name of ['chromium', 'android-chrome', 'firefox', 'iphone-webkit']) {
        for (const file of regressionFiles) {
            it(`selects ${file} on ${name}`, () => {
                const project = config.projects?.find((entry) => entry.name === name);
                expect(project).toBeDefined();
                if (!project) throw new Error(`Missing browser project: ${name}`);
                assertSelected(config, project, file);
            });
        }
    }

    it('runs new no-capture acceptance on WebKit in the reusable release workflow', () => {
        const workflow = readFileSync('.github/workflows/e2e.yml', 'utf8');
        const step = workflow.split('      - name: Run iPhone/WebKit media gate\n')[1]?.split('\n      - ')[0];
        expect(step).toBeDefined();
        expect(step).toContain('e2e/tests/audio-activation.spec.ts');
        expect(step).toContain('e2e/tests/continuity-navigation.spec.ts');
        expect(step).not.toContain('if:');
    });

    for (const name of [
        'Install Firefox after Chromium screenshot gates',
        'Run Firefox functional and accessibility gates',
        'Install WebKit after Chromium screenshot gates',
    ]) {
        it(`does not skip ${name} on release`, () => {
            const workflow = readFileSync('.github/workflows/e2e.yml', 'utf8');
            const step = workflow.split(`      - name: ${name}\n`)[1]?.split('\n      - ')[0];
            expect(step).toBeDefined();
            expect(step).not.toContain('if:');
        });
    }
});
