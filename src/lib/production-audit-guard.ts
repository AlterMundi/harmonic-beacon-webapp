type AuditRecord = {
    severity?: unknown;
};

type AuditReport = {
    auditReportVersion?: unknown;
    vulnerabilities?: unknown;
};

export type ProductionAuditDecision = {
    ok: boolean;
    usedException: false;
    message: string;
};

const HIGH_SEVERITIES = new Set(['high', 'critical']);

function fail(message: string): ProductionAuditDecision {
    return { ok: false, usedException: false, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Fail closed on every high/critical production advisory. */
export function evaluateProductionAudit(reportValue: unknown): ProductionAuditDecision {
    if (!isRecord(reportValue)) {
        return fail('npm audit returned a non-object report');
    }

    const report = reportValue as AuditReport;
    if (report.auditReportVersion !== 2 || !isRecord(report.vulnerabilities)) {
        return fail('npm audit report schema is not the reviewed v2 shape');
    }

    const highNames = Object.entries(report.vulnerabilities as Record<string, AuditRecord>)
        .filter(([, record]) => HIGH_SEVERITIES.has(String(record.severity)))
        .map(([name]) => name)
        .sort();
    if (highNames.length > 0) {
        return fail(`unexpected high/critical production advisories: ${highNames.join(', ')}`);
    }

    return {
        ok: true,
        usedException: false,
        message: 'No high or critical production dependency advisories found.',
    };
}
