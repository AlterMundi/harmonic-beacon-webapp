import { describe, expect, it } from 'vitest';

import {
    STAFF_ROLES,
    eventStaffPolicy,
    hasGlobalEventAccess,
    hasStaffCapability,
    type StaffCapability,
} from '../staff-capabilities';

const CAPABILITIES: StaffCapability[] = [
    'administer_system',
    'view_operations_health',
    'look_up_admission',
    'mutate_entitlement',
    'manage_ticket_batches',
    'issue_comp',
    'issue_support_override',
];

const EXPECTED_GLOBAL: Record<(typeof STAFF_ROLES)[number], StaffCapability[]> = {
    FACILITATOR: ['view_operations_health', 'look_up_admission'],
    OPERATOR: [
        'view_operations_health',
        'look_up_admission',
        'mutate_entitlement',
        'issue_support_override',
    ],
    ADMIN: CAPABILITIES,
    FACILITATOR_OP: CAPABILITIES,
};

describe('staff capability policy', () => {
    it.each(STAFF_ROLES)('defines every global capability for %s', (role) => {
        for (const capability of CAPABILITIES) {
            expect(
                hasStaffCapability(role, capability),
                `${role} × ${capability}`,
            ).toBe(EXPECTED_GLOBAL[role].includes(capability));
        }
    });

    it.each([
        ['FACILITATOR', false, false, false, false],
        ['FACILITATOR', true, true, true, true],
        ['OPERATOR', false, true, false, false],
        ['OPERATOR', true, true, false, false],
        ['ADMIN', false, true, false, false],
        ['ADMIN', true, true, false, false],
        ['FACILITATOR_OP', false, true, false, false],
        ['FACILITATOR_OP', true, true, true, true],
    ] as const)(
        '%s assigned=%s => operate=%s facilitator=%s initialPublish=%s',
        (role, assigned, operate, facilitator, initialPublish) => {
            expect(eventStaffPolicy(role, assigned)).toEqual({
                canOperateEvent: operate,
                isAssignedFacilitator: facilitator,
                canPublishInitially: initialPublish,
            });
        },
    );

    it.each([
        ['FACILITATOR', false],
        ['OPERATOR', true],
        ['ADMIN', true],
        ['FACILITATOR_OP', true],
    ] as const)('global event access for %s is %s', (role, expected) => {
        expect(hasGlobalEventAccess(role)).toBe(expected);
    });
});
