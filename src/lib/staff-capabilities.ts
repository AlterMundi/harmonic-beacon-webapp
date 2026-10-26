import type { StaffRole } from '@prisma/client';

/** Every shipped staff role, kept explicit so policy tests are exhaustive. */
export const STAFF_ROLES = [
    'FACILITATOR',
    'FACILITATOR_OP',
    'OPERATOR',
    'ADMIN',
] as const satisfies readonly StaffRole[];

export type StaffCapability =
    | 'manage_events'
    | 'administer_system'
    | 'view_operations_health'
    | 'look_up_admission'
    | 'mutate_entitlement'
    | 'manage_ticket_batches'
    | 'issue_comp'
    | 'issue_support_override';

const GLOBAL_CAPABILITIES: Record<StaffRole, ReadonlySet<StaffCapability>> = {
    FACILITATOR: new Set([
        'manage_events', 'view_operations_health', 'look_up_admission',
    ]),
    OPERATOR: new Set([
        'manage_events',
        'view_operations_health',
        'look_up_admission',
        'mutate_entitlement',
        'issue_support_override',
    ]),
    ADMIN: new Set([
        'administer_system',
        'manage_events',
        'view_operations_health',
        'look_up_admission',
        'mutate_entitlement',
        'manage_ticket_batches',
        'issue_comp',
        'issue_support_override',
    ]),
    FACILITATOR_OP: new Set([
        'administer_system',
        'manage_events',
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
    /** Capacity-checked initial staff publication; media capture still needs consent. */
    canPublishInitially: boolean;
};

/**
 * Sai's 2026-10-26 room policy: every enabled staff role may operate events.
 * Assignment describes who leads; it is not a second access grant. Unassigned staff opt into publication through the same stage tools. Publication
 * still goes through the durable grant/capacity lock, and capture needs a gesture.
 */
export function eventStaffPolicy(role: StaffRole, assignedToEvent: boolean): EventStaffPolicy {
    const isAssignedFacilitator = (role === 'FACILITATOR' || role === 'FACILITATOR_OP') && assignedToEvent;
    return { canOperateEvent: STAFF_ROLES.includes(role), isAssignedFacilitator,
        canPublishInitially: isAssignedFacilitator };
}

export function hasGlobalEventAccess(role: StaffRole): boolean {
    return STAFF_ROLES.includes(role);
}
