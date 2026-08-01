# `FACILITATOR_OP` rollout and rollback

`FACILITATOR_OP` is an additive database role for a person who needs global
administrative and operational access while facilitating one assigned event.
The role never makes its holder the facilitator of an unassigned event.

## Rollout

1. Apply the additive Prisma migration and deploy code that recognizes
   `FACILITATOR_OP` everywhere.
2. Run the authorization matrix and event-room smoke checks.
3. Only then set `STAFF_FACILITATOR_ROLE=FACILITATOR_OP` for a seed run or
   explicitly update the intended account. The migration does not promote any
   existing user.
4. Confirm the account can operate another event without receiving an initial
   publish grant there, and can publish initially in its assigned event.

## Rollback

PostgreSQL enum values are not safely removed in place. Before deploying an
older application that does not recognize the composite role, reassign every
`FACILITATOR_OP` user to one of the older roles:

```sql
SELECT id, email FROM users WHERE role = 'FACILITATOR_OP';
UPDATE users SET role = 'FACILITATOR' WHERE role = 'FACILITATOR_OP';
```

Choose `FACILITATOR`, `OPERATOR`, or `ADMIN` deliberately for each account;
the example uses the least surprising rollback for the seeded facilitator.
After no row uses the new value, the previous application can be restored.
Leave the unused enum value and nullable `audit_logs.actor_role` column in
place; removing either requires a separate, reviewed PostgreSQL type rebuild.
