import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(resolve(
    process.cwd(),
    'prisma/migrations/20260818010000_beacon_account_authority/migration.sql',
), 'utf8');

describe('Account authority forward-only migration contract', () => {
    it('revokes legacy sessions/artifacts without replacing canonical accounts', () => {
        expect(sql).toContain('DELETE FROM "early_bird_auth_sessions";');
        expect(sql).toContain('DELETE FROM "early_bird_verifications";');
        expect(sql).toContain('DELETE FROM "early_bird_magic_link_throttles";');
        expect(sql).not.toMatch(/DELETE FROM\s+"early_bird_users"/);
        expect(sql).not.toMatch(/DROP TABLE\s+"early_bird_users"/);
        expect(sql).not.toMatch(/DROP TABLE\s+"early_bird_membership_projections"/);
    });

    it('enforces one access method and no persisted provider credentials', () => {
        expect(sql).toContain('CREATE UNIQUE INDEX "early_bird_identities_user_id_key"');
        expect(sql).toContain('"early_bird_identities_no_provider_tokens_check"');
        for (const column of ['access_token', 'refresh_token', 'id_token', 'scope']) {
            expect(sql).toContain(`"${column}" IS NULL`);
        }
    });

    it('preserves opaque account identity across RP and profile records', () => {
        expect(sql).toContain('"beacon_profiles_account_id_fkey"');
        expect(sql).toContain('"listener_account_subjects_issuer_subject_key"');
        expect(sql).toContain('"listener_account_sessions_account_id_fkey"');
        expect(sql).not.toContain('"listener_account_sessions_subject_matches_account_check"');
        expect(sql).toContain('"beacon_profile_after_account_insert_trigger"');
    });

    it('cannot downgrade a static OAuth client below the confidential v1 contract', () => {
        expect(sql).toContain('"token_endpoint_auth_method" = \'client_secret_basic\'');
        expect(sql).toContain('"grant_types" = ARRAY[\'authorization_code\']::TEXT[]');
        expect(sql).toContain('"response_types" = ARRAY[\'code\']::TEXT[]');
        expect(sql).toContain('"scopes" = ARRAY[\'openid\', \'profile\']::TEXT[]');
        expect(sql).toContain('"disabled" = true OR (');
        expect(sql).toContain('"skip_consent" = true');
        expect(sql).toContain('"enable_end_session" = true');
        expect(sql).toContain('"subject_type" = \'public\'');
        expect(sql).toContain('"type" = \'web\'');
    });

    it('keeps the durable mail outbox schema byte-aligned with Prisma', () => {
        const throttle = sql.slice(
            sql.indexOf('CREATE TABLE "beacon_account_auth_throttles"'),
            sql.indexOf('CREATE TABLE "beacon_account_mail_outbox"'),
        );
        const outbox = sql.slice(
            sql.indexOf('CREATE TABLE "beacon_account_mail_outbox"'),
            sql.indexOf('CREATE TABLE "listener_account_subjects"'),
        );
        expect(throttle).not.toContain('"generation"');
        expect(outbox).toContain('"generation" INTEGER NOT NULL DEFAULT 1');
        for (const column of [
            '"sealed_token" TEXT',
            '"token_expires_at" TIMESTAMP(3)',
            '"idempotency_key" TEXT',
            '"delivery_attempted_at" TIMESTAMP(3)',
        ]) expect(outbox).toContain(column);
        expect(outbox).toContain('"beacon_account_mail_outbox_generation_check"');
        expect(outbox).toContain("'^[0-9a-f]{64}$'");
        expect(outbox).toContain('"beacon_account_mail_outbox_payload_shape_check"');
        expect(outbox).toContain('"beacon_account_mail_outbox_account_id_purpose_generation_key"');
        expect(outbox).toContain('"beacon_account_mail_outbox_next_attempt_at_locked_at_idx"');
        expect(outbox.match(/CURRENT_TIMESTAMP \+ INTERVAL '5 seconds'/g)).toHaveLength(2);
    });
});
