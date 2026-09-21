# Verified Account attendance email backfill

This is a one-time, metadata-only convergence for public free attendance that
predates Live's Account email snapshot. It does not create attendance, alter
presence, move the amplification-credit cursor, replay feed entries, or award
credit. Execution remains inside the active operation's authorized environment
and scope; access alone never broadens that scope.

## Exact data boundary

The target entitlement must satisfy every condition below:

- both `account_email` and `account_email_verified` are `NULL`;
- `bound_email` is `NULL`, tier is `COMP`, and `code_last_four` is `FREE`;
- its scheduled session is public;
- it has no commerce entitlement; and
- its opaque Account issuer and subject are already bound.

The only source is `web_sessions`, joined by the exact opaque
`(account_issuer, account_subject)` pair. A target is eligible only when all
historical verified, non-null Account snapshots for that identity contain one
exact distinct email and that value is at most 254 Unicode characters. No
source, multiple distinct verified values, an oversized sole value, and
unverified values all remain untouched. Existing entitlement snapshots are
never overwritten. Names, aliases, provider email, ticket text and timestamps
are not identity inputs.

## Utility and receipt

[`scripts/live-production/backfill-account-attendance-email.ts`](../../scripts/live-production/backfill-account-attendance-email.ts)
defaults to dry-run. `--apply` is the only write mode. Both modes run at
`SERIALIZABLE`; apply re-evaluates its candidate CTE in the update statement,
then re-runs all aggregates before commit. Any count mismatch throws and rolls
the transaction back.

The single JSON receipt contains counts only:

- total missing eligible targets;
- targets with one usable source;
- targets with no verified source, ambiguous sources, or a sole oversized
  source;
- usable targets that already have a feed-eligible presence row;
- rows actually updated; and
- the same aggregates after apply.

It contains no email, issuer, subject, ticket, participant, session or feed
entry identifier. Database errors must remain in the restricted operator log;
do not paste raw database diagnostics into a public issue.

## Preconditions

1. Work from the exact reviewed Live revision containing this utility and the
   Account snapshot migration.
2. Confirm no other operator owns a data mutation on the Live database.
3. Verify the current backup and compatible restore path under the operating
   contract. A successful metadata backfill has no broad guessed rollback.
4. Confirm the environment exposes the exact production issuer and database
   through the existing protected secret path. Never print `DATABASE_URL`.
5. Select one exact target and set its guards in the restricted root process
   environment. Both targets require
   `LIVE_ACCOUNT_ATTENDANCE_EMAIL_BACKFILL_ENABLED=1`. Production additionally
   requires `LIVE_PRODUCTION_ENVIRONMENT=production` and
   `BEACON_ACCOUNT_ISSUER_URL=https://account.harmonicbeacon.com`; staging
   requires `LIVE_STAGING_ENVIRONMENT=live-staging` and
   `BEACON_ACCOUNT_ISSUER_URL=https://account-staging.harmonicbeacon.com`.

The utility additionally requires root and exact database identity readback:
`beacon` for `--target production`, or `beacon_live_staging` for
`--target staging`. It refuses developer databases. The integration test is
the isolated rehearsal path.

## Reviewed execution sequence

From the exact reviewed checkout, with protected environment values already
loaded without displaying them:

```sh
node --import tsx scripts/live-production/backfill-account-attendance-email.ts \
  --target staging
```

After the required `--target`, omitting the mode flag and adding `--dry-run`
are equivalent. Replace `staging` with `production` only in the corresponding
guarded environment. Preserve the aggregate receipt and review that the
ambiguity/no-source counts remain excluded. If the expected change count
differs from the receipt, stop; do not weaken the predicate.

After the operator verifies the backup, exact target, predicates and dry-run
receipt within the active authorized operation, proceed directly with apply:

```sh
node --import tsx scripts/live-production/backfill-account-attendance-email.ts \
  --target staging --apply
```

Apply must report `updatedCount == before.wouldUpdateCount`, zero remaining
`after.wouldUpdateCount`, and unchanged excluded-category counts. Immediately
run dry-run again for the same explicit target; it must be `no-op` unless new authenticated
Account callbacks legitimately created new candidates after the transaction.
Record the exact revision and the aggregate receipts in the existing PR or
operation record, not a new parallel journal.

## Feed and consumer boundary

The feed is a live projection. A fresh scan reflects the new email, but the
entry's stable `entry_id` and `(entered_at, entry_id)` position do not change.
A consumer already past that cursor will not receive the metadata correction
through normal tail polling.

Do not reset a consumer cursor, edit presence timestamps, manufacture another
interval, or resend credits. `affectedFeedEntryCount` says only that an updated
target has a feed-eligible entry; it does not prove whether the consumer
already committed it. Historical downstream correction requires separate
evidence that the existing consumer can update metadata idempotently by stable
`entry_id` without awarding credit again. Without that evidence, leave the
already-consumed downstream email `NULL`; this backfill still corrects Live and
all future fresh reads.

## Verification

Focused deterministic checks are:

```sh
npm test -- --run scripts/live-production/__tests__/backfill-account-attendance-email.test.ts
ACCOUNT_ATTENDANCE_EMAIL_BACKFILL_INTEGRATION_TEST=1 \
  DATABASE_URL='<isolated *_test database>' \
  npm test -- --run scripts/live-production/__tests__/backfill-account-attendance-email.integration.test.ts
```

The integration suite refuses a non-test database, creates only synthetic
rows, and cleans them up. It proves dry-run, the unique verified update,
ambiguous/unverified/oversized/private exclusion, non-overwrite, aggregate feed
impact and idempotent apply replay. It does not prove production state or
consumer replay safety.
