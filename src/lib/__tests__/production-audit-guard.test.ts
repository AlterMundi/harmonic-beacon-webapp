import { describe, expect, it } from 'vitest';

import { evaluateProductionAudit } from '../production-audit-guard';

describe('production dependency audit guard', () => {
    it('passes a clean high/critical report without using an exception', () => {
        expect(evaluateProductionAudit({
            auditReportVersion: 2,
            vulnerabilities: {},
        })).toMatchObject({ ok: true, usedException: false });
    });

    it.each(['high', 'critical'])('rejects every %s production advisory', (severity) => {
        expect(evaluateProductionAudit({
            auditReportVersion: 2,
            vulnerabilities: {
                vulnerable: { severity },
            },
        })).toMatchObject({
            ok: false,
            usedException: false,
            message: expect.stringContaining('vulnerable'),
        });
    });

    it('rejects a malformed or unexpected audit schema', () => {
        expect(evaluateProductionAudit(null)).toMatchObject({ ok: false });
        expect(evaluateProductionAudit({ auditReportVersion: 1, vulnerabilities: {} }))
            .toMatchObject({ ok: false });
        expect(evaluateProductionAudit({ auditReportVersion: 2, vulnerabilities: [] }))
            .toMatchObject({ ok: false });
    });
});
