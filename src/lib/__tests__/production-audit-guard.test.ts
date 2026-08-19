import { describe, expect, it } from 'vitest';

import {
    evaluateProductionAudit,
    type InstalledAuditPackages,
} from '../production-audit-guard';

const installed: InstalledAuditPackages = {
    prisma: {
        version: '7.9.1',
        dependencies: { '@prisma/config': '7.9.1' },
    },
    '@prisma/config': {
        version: '7.9.1',
        dependencies: { 'deepmerge-ts': '7.1.5' },
    },
    'deepmerge-ts': {
        version: '7.1.5',
        dependencies: {},
    },
};

function exactReport() {
    return {
        auditReportVersion: 2,
        vulnerabilities: {
            '@prisma/config': {
                name: '@prisma/config',
                severity: 'high',
                isDirect: false,
                via: ['deepmerge-ts'],
                effects: ['prisma'],
                range: '>=6.13.0-dev.1',
                nodes: ['node_modules/@prisma/config'],
            },
            'deepmerge-ts': {
                name: 'deepmerge-ts',
                severity: 'high',
                isDirect: false,
                via: [{
                    source: 1145093,
                    name: 'deepmerge-ts',
                    dependency: 'deepmerge-ts',
                    url: 'https://github.com/advisories/GHSA-ggr8-5vv4-36mx',
                    severity: 'high',
                    range: '<8.0.0',
                }],
                effects: ['@prisma/config'],
                range: '<8.0.0',
                nodes: ['node_modules/deepmerge-ts'],
            },
            prisma: {
                name: 'prisma',
                severity: 'high',
                isDirect: true,
                via: ['@prisma/config'],
                effects: [],
                range: '6.13.0-dev.1 - 7.10.0-integration-fix-prisma-publish-token.1',
                nodes: ['node_modules/prisma'],
            },
        },
        metadata: { vulnerabilities: { high: 3, critical: 0 } },
    };
}

describe('production dependency audit guard', () => {
    it('passes a clean high/critical report without using the exception', () => {
        const decision = evaluateProductionAudit(
            { auditReportVersion: 2, vulnerabilities: {}, metadata: {} },
            undefined,
        );

        expect(decision).toMatchObject({ ok: true, usedException: false });
    });

    it('allows only the exact reviewed Prisma deepmerge advisory chain', () => {
        const decision = evaluateProductionAudit(exactReport(), installed, new Date('2026-08-18T00:00:00Z'));

        expect(decision).toMatchObject({ ok: true, usedException: true });
    });

    it('fails when any additional high advisory appears', () => {
        const report = exactReport();
        Object.assign(report.vulnerabilities, {
            other: {
                name: 'other',
                severity: 'critical',
                isDirect: true,
                via: [],
                effects: [],
                range: '*',
                nodes: ['node_modules/other'],
            },
        });

        expect(evaluateProductionAudit(report, installed)).toMatchObject({ ok: false });
    });

    it('fails if the advisory identity or installed package path changes', () => {
        const wrongAdvisory = exactReport();
        wrongAdvisory.vulnerabilities['deepmerge-ts'].via[0].source = 999;
        expect(evaluateProductionAudit(wrongAdvisory, installed)).toMatchObject({ ok: false });

        const wrongPath = exactReport();
        wrongPath.vulnerabilities['deepmerge-ts'].nodes = ['node_modules/prisma/node_modules/deepmerge-ts'];
        expect(evaluateProductionAudit(wrongPath, installed)).toMatchObject({ ok: false });
    });

    it('fails if any reviewed package version or direct dependency edge changes', () => {
        const changedVersion = structuredClone(installed);
        changedVersion['deepmerge-ts'].version = '8.0.0';
        expect(evaluateProductionAudit(exactReport(), changedVersion)).toMatchObject({ ok: false });

        const changedEdge = structuredClone(installed);
        changedEdge.prisma.dependencies['@prisma/config'] = '^7.9.1';
        expect(evaluateProductionAudit(exactReport(), changedEdge)).toMatchObject({ ok: false });
    });

    it('expires closed on the mandatory review date', () => {
        const decision = evaluateProductionAudit(exactReport(), installed, new Date('2026-09-15T00:00:00Z'));

        expect(decision).toMatchObject({ ok: false });
        expect(decision.message).toContain('expired');
    });
});
