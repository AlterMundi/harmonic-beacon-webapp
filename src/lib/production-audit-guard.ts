const PRISMA_EXCEPTION = {
    advisorySource: 1145093,
    advisoryUrl: 'https://github.com/advisories/GHSA-ggr8-5vv4-36mx',
    reviewBy: '2026-09-15T00:00:00.000Z',
    packages: {
        prisma: '7.9.1',
        '@prisma/config': '7.9.1',
        'deepmerge-ts': '7.1.5',
    },
} as const;

export type InstalledAuditPackage = {
    version: string;
    dependencies: Record<string, string>;
};

export type InstalledAuditPackages = Record<
    keyof typeof PRISMA_EXCEPTION.packages,
    InstalledAuditPackage
>;

type AuditRecord = {
    name?: unknown;
    severity?: unknown;
    isDirect?: unknown;
    via?: unknown;
    effects?: unknown;
    range?: unknown;
    nodes?: unknown;
    fixAvailable?: unknown;
};

type AuditReport = {
    auditReportVersion?: unknown;
    vulnerabilities?: unknown;
    metadata?: unknown;
};

export type ProductionAuditDecision = {
    ok: boolean;
    usedException: boolean;
    message: string;
};

const HIGH_SEVERITIES = new Set(['high', 'critical']);
const EXPECTED_NAMES = ['@prisma/config', 'deepmerge-ts', 'prisma'] as const;

function fail(message: string): ProductionAuditDecision {
    return { ok: false, usedException: false, message };
}

function exactStrings(value: unknown, expected: readonly string[]): boolean {
    return Array.isArray(value)
        && value.length === expected.length
        && value.every((item, index) => item === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateInstalledChain(installed: InstalledAuditPackages): string | null {
    for (const [name, version] of Object.entries(PRISMA_EXCEPTION.packages)) {
        if (installed[name as keyof InstalledAuditPackages]?.version !== version) {
            return `${name} must remain exactly ${version} while the exception is active`;
        }
    }

    if (installed.prisma.dependencies['@prisma/config'] !== '7.9.1') {
        return 'prisma must depend directly on @prisma/config 7.9.1';
    }
    if (installed['@prisma/config'].dependencies['deepmerge-ts'] !== '7.1.5') {
        return '@prisma/config must depend directly on deepmerge-ts 7.1.5';
    }

    return null;
}

function validateDeepmergeAdvisory(record: AuditRecord): boolean {
    if (!Array.isArray(record.via) || record.via.length !== 1 || !isRecord(record.via[0])) {
        return false;
    }

    const advisory = record.via[0];
    return record.name === 'deepmerge-ts'
        && record.severity === 'high'
        && record.isDirect === false
        && exactStrings(record.effects, ['@prisma/config'])
        && record.range === '<8.0.0'
        && exactStrings(record.nodes, ['node_modules/deepmerge-ts'])
        && advisory.source === PRISMA_EXCEPTION.advisorySource
        && advisory.name === 'deepmerge-ts'
        && advisory.dependency === 'deepmerge-ts'
        && advisory.url === PRISMA_EXCEPTION.advisoryUrl
        && advisory.severity === 'high'
        && advisory.range === '<8.0.0';
}

function validateDependentRecords(vulnerabilities: Record<string, AuditRecord>): boolean {
    const config = vulnerabilities['@prisma/config'];
    const prisma = vulnerabilities.prisma;

    return config.name === '@prisma/config'
        && config.severity === 'high'
        && config.isDirect === false
        && exactStrings(config.via, ['deepmerge-ts'])
        && exactStrings(config.effects, ['prisma'])
        && exactStrings(config.nodes, ['node_modules/@prisma/config'])
        && prisma.name === 'prisma'
        && prisma.severity === 'high'
        && prisma.isDirect === true
        && exactStrings(prisma.via, ['@prisma/config'])
        && exactStrings(prisma.effects, [])
        && exactStrings(prisma.nodes, ['node_modules/prisma']);
}

export function evaluateProductionAudit(
    reportValue: unknown,
    installed: InstalledAuditPackages | undefined,
    now = new Date(),
): ProductionAuditDecision {
    if (!isRecord(reportValue)) {
        return fail('npm audit returned a non-object report');
    }

    const report = reportValue as AuditReport;
    if (report.auditReportVersion !== 2 || !isRecord(report.vulnerabilities)) {
        return fail('npm audit report schema is not the reviewed v2 shape');
    }

    const vulnerabilities = report.vulnerabilities as Record<string, AuditRecord>;
    const highNames = Object.entries(vulnerabilities)
        .filter(([, record]) => HIGH_SEVERITIES.has(String(record.severity)))
        .map(([name]) => name)
        .sort();

    if (highNames.length === 0) {
        return {
            ok: true,
            usedException: false,
            message: 'No high or critical production dependency advisories found.',
        };
    }

    if (!exactStrings(highNames, EXPECTED_NAMES)) {
        return fail(`unexpected high/critical production advisories: ${highNames.join(', ')}`);
    }

    if (!installed) {
        return fail('could not inspect the exact installed Prisma dependency chain');
    }

    const reviewBy = new Date(PRISMA_EXCEPTION.reviewBy);
    if (!Number.isFinite(now.getTime()) || now >= reviewBy) {
        return fail(`Prisma deepmerge exception expired for review on ${PRISMA_EXCEPTION.reviewBy}`);
    }

    const chainError = validateInstalledChain(installed);
    if (chainError) {
        return fail(chainError);
    }

    if (!validateDeepmergeAdvisory(vulnerabilities['deepmerge-ts'])) {
        return fail('deepmerge-ts advisory no longer matches the exact reviewed advisory and path');
    }
    if (!validateDependentRecords(vulnerabilities)) {
        return fail('Prisma advisory propagation no longer matches the exact reviewed dependency path');
    }

    return {
        ok: true,
        usedException: true,
        message: `Allowed only ${PRISMA_EXCEPTION.advisoryUrl} through Prisma 7.9.1; review by ${PRISMA_EXCEPTION.reviewBy}.`,
    };
}

export { PRISMA_EXCEPTION };
