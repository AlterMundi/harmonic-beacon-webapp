import type { StaffRole } from '@prisma/client';

/** Every shipped staff role, kept explicit so policy tests are exhaustive. */
export const STAFF_ROLES = [
    'FACILITATOR',
    'FACILITATOR_OP',
    'OPERATOR',
    'ADMIN',
] as const satisfies readonly StaffRole[];

export type StaffCapability =
    | 'administer_system'
    | 'view_operations_health'
    | 'look_up_admission'
    | 'mutate_entitlement'
    | 'manage_ticket_batches'
    | 'issue_comp'
    | 'issue_support_override';

const GLOBAL_CAPABILITIES: Record<StaffRole, ReadonlySet<StaffCapability>> = {
    FACILITATOR: new Set([
        'view_operations_health',
        'look_up_admission',
    ]),
    OPERATOR: new Set([
        'view_operations_health',
        'look_up_admission',
        'mutate_entitlement',
        'issue_support_override',
    ]),
    ADMIN: new Set([
        'administer_system',
        'view_operations_health',
        'look_up_admission',
        'mutate_entitlement',
        'manage_ticket_batches',
        'issue_comp',
        'issue_support_override',
    ]),
    FACILITATOR_OP: new Set([
        'administer_system',
        'view_operations_health',
        'look_up_admission',
        'mutate_entitlement',
        'manage_ticket_batches',
        'issue_comp',
        'issue_support_override',
    ]),
};

/** Non-event capability check. Event-scoped authority uses `eventStaffPolicy`. */
export function hasStaffCapability(
    role: StaffRole,
    capability: StaffCapability,
): boolean {
    return GLOBAL_CAPABILITIES[role].has(capability);
}

export type EventStaffPolicy = {
    /** May view and operate the event's stage, participants, and tapestry. */
    canOperateEvent: boolean;
    /** The real assignment, with a role that is allowed facilitator treatment. */
    isAssignedFacilitator: boolean;
    /** Initial microphone/camera publication; intentionally narrower than operation. */
    canPublishInitially: boolean;
};

/**
 * Resolve the asymmetric event policy once.
 *
 * `FACILITATOR_OP` operates every event, like ADMIN, but only becomes the
 * facilitator and receives an initial publish grant in its assigned event.
 */
export function eventStaffPolicy(
    role: StaffRole,
    assignedToEvent: boolean,
): EventStaffPolicy {
    const facilitatorRole = role === 'FACILITATOR' || role === 'FACILITATOR_OP';
    const isAssignedFacilitator = facilitatorRole && assignedToEvent;
    const hasGlobalAccess = role === 'FACILITATOR_OP' ||
        role === 'OPERATOR' ||
        role === 'ADMIN';
    return {
        canOperateEvent: hasGlobalAccess || (role === 'FACILITATOR' && assignedToEvent),
        isAssignedFacilitator,
        canPublishInitially: isAssignedFacilitator,
    };
}

/** Whether event listings should be scoped to the current user's assignments. */
export function hasGlobalEventAccess(role: StaffRole): boolean {
    return role === 'FACILITATOR_OP' || role === 'OPERATOR' || role === 'ADMIN';
}
