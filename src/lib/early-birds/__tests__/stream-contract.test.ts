import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    EARLY_BIRD_LEASE_MANIFEST_PATH,
    earlyBirdOriginConfig,
    earlyBirdOriginManifestPath,
    earlyBirdStreamUrlIssuer,
    EarlyBirdStreamIssuerUnavailableError,
    setEarlyBirdStreamUrlIssuerForTests,
    signEarlyBirdOriginPath,
    signedEarlyBirdOriginManifestUrl,
    validSignedOriginManifest,
} from '../stream';

const SECRET = 'x'.repeat(32);

afterEach(() => {
    setEarlyBirdStreamUrlIssuerForTests(null);
    vi.unstubAllEnvs();
});

describe('Beacon origin signing contract', () => {
    it('matches the byte-exact services/beacon-stream signer and its fixture', async () => {
        const { signPath } = await import('../../../../services/beacon-stream/src/auth.mjs');
        const input = {
            secret: SECRET,
            pathname: '/v1/hls/approved-v1/live.m3u8',
            expiresAt: 1_100,
        };
        const beaconSignature = signEarlyBirdOriginPath(input);
        expect(beaconSignature).toBe('tb9hrzcc1Q7Ji_LOxvAlbmmBCDyTOpvnptAOSVMW1nA');
        expect(beaconSignature).toBe(signPath(input));
    });

    it('caps origin authorization at the lease horizon and emits exp/sig only server-side', () => {
        const config = {
            origin: 'https://stream.example.test',
            artifactId: 'approved-v1',
            signingSecret: SECRET,
        };
        const url = new URL(signedEarlyBirdOriginManifestUrl({
            config,
            now: new Date('1970-01-01T00:16:40.000Z'),
            leaseExpiresAt: new Date('1970-01-01T00:16:45.000Z'),
        }));
        expect(url.pathname).toBe(earlyBirdOriginManifestPath('approved-v1'));
        expect(url.searchParams.get('exp')).toBe('1005');
        expect(url.searchParams.get('sig')).toBeTruthy();
    });

    it('fails closed for missing, short-secret, malformed artifact, and HTTP production config', () => {
        expect(() => earlyBirdOriginConfig({} as NodeJS.ProcessEnv)).toThrow(EarlyBirdStreamIssuerUnavailableError);
        expect(() => earlyBirdOriginConfig({
            NODE_ENV: 'test',
            EARLY_BIRDS_STREAM_ORIGIN: 'https://stream.example.test',
            EARLY_BIRDS_STREAM_ARTIFACT_ID: '../escape',
            EARLY_BIRDS_STREAM_SIGNING_SECRET: SECRET,
        } as NodeJS.ProcessEnv)).toThrow(EarlyBirdStreamIssuerUnavailableError);
        expect(() => earlyBirdOriginConfig({
            NODE_ENV: 'production',
            EARLY_BIRDS_STREAM_ORIGIN: 'http://stream.example.test',
            EARLY_BIRDS_STREAM_ARTIFACT_ID: 'approved-v1',
            EARLY_BIRDS_STREAM_SIGNING_SECRET: SECRET,
        } as NodeJS.ProcessEnv)).toThrow(EarlyBirdStreamIssuerUnavailableError);
    });

    it('accepts only manifests whose every media URI is an individually signed origin segment', () => {
        const config = {
            origin: 'https://stream.example.test',
            artifactId: 'approved-v1',
            signingSecret: SECRET,
        };
        const manifest = [
            '#EXTM3U',
            '#EXT-X-VERSION:7',
            '#EXTINF:6.000,',
            'https://stream.example.test/v1/hls/approved-v1/segments/000001.m4s?exp=1100&sig=abc',
            '',
        ].join('\n');
        expect(validSignedOriginManifest(manifest, config)).toBe(true);
        expect(validSignedOriginManifest(manifest.replace('stream.example.test', 'evil.example'), config)).toBe(false);
        expect(validSignedOriginManifest(manifest.replace('&sig=abc', ''), config)).toBe(false);
    });

    it('gives browsers only the stable same-origin lease manifest URL', async () => {
        vi.stubEnv('EARLY_BIRDS_STREAM_ORIGIN', 'https://stream.example.test');
        vi.stubEnv('EARLY_BIRDS_STREAM_ARTIFACT_ID', 'approved-v1');
        vi.stubEnv('EARLY_BIRDS_STREAM_SIGNING_SECRET', SECRET);
        const grant = await earlyBirdStreamUrlIssuer().issue({
            accountId: 'listener-1',
            leaseId: '00000000-0000-4000-8000-000000000111',
            issuedAt: new Date(),
            leaseExpiresAt: new Date(Date.now() + 60_000),
        });
        expect(grant.manifestUrl).toBe(`${EARLY_BIRD_LEASE_MANIFEST_PATH}?leaseId=00000000-0000-4000-8000-000000000111`);
        expect(grant.manifestUrl).not.toContain('sig=');
        expect(grant.manifestUrl).not.toContain('stream.example.test');
    });
});
