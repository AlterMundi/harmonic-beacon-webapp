import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    EnvironmentManifestIssuer,
    earlyBirdOriginConfig,
    earlyBirdOriginManifestPath,
    earlyBirdStreamControlOrigin,
    signEarlyBirdStreamControlRequest,
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

    it('matches the origin grant-control request signer byte for byte', async () => {
        const { signControlRequest } = await import('../../../../services/beacon-stream/src/control-auth.mjs');
        const input = {
            secret: SECRET,
            pathname: `/internal/v1/listener/media-grants/${'a'.repeat(64)}`,
            timestamp: 1_800_000_000,
            body: '{"tokenSha256":"abc","expiresAtMs":1800000180000}',
        };
        expect(signEarlyBirdStreamControlRequest(input)).toBe(signControlRequest(input));
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
        expect(() => earlyBirdStreamControlOrigin({
            NODE_ENV: 'production',
            EARLY_BIRDS_STREAM_CONTROL_ORIGIN: 'https://external.example.test',
        } as NodeJS.ProcessEnv)).toThrow(EarlyBirdStreamIssuerUnavailableError);
        expect(earlyBirdStreamControlOrigin({
            NODE_ENV: 'production',
            EARLY_BIRDS_STREAM_CONTROL_ORIGIN: 'http://beacon-stream:8080',
        } as NodeJS.ProcessEnv)).toBe('http://beacon-stream:8080');
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
            '#EXT-X-MAP:URI="https://stream.example.test/v1/hls/approved-v1/segments/init.mp4?exp=1100&sig=map-signature"',
            '#EXTINF:6.000,',
            'https://stream.example.test/v1/hls/approved-v1/segments/000001.m4s?exp=1100&sig=abc',
            '',
        ].join('\n');
        expect(validSignedOriginManifest(manifest, config)).toBe(true);
        expect(validSignedOriginManifest(manifest.replace('stream.example.test', 'evil.example'), config)).toBe(false);
        expect(validSignedOriginManifest(manifest.replace('&sig=abc', ''), config)).toBe(false);
        expect(validSignedOriginManifest(manifest.replace('&sig=map-signature', ''), config)).toBe(false);
    });

    it('registers a stable opaque grant privately and gives the browser a direct origin URL', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
        const issuer = new EnvironmentManifestIssuer({
            NODE_ENV: 'production',
            EARLY_BIRDS_STREAM_ORIGIN: 'https://stream.example.test',
            EARLY_BIRDS_STREAM_CONTROL_ORIGIN: 'http://beacon-stream:8080',
            EARLY_BIRDS_STREAM_ARTIFACT_ID: 'approved-v1',
            EARLY_BIRDS_STREAM_SIGNING_SECRET: SECRET,
        } as NodeJS.ProcessEnv, fetchMock);
        const issuedAt = new Date('2027-01-15T08:00:00.000Z');
        const request = {
            accountId: 'listener-1',
            leaseId: '00000000-0000-4000-8000-000000000111',
            leaseGeneration: 7,
            issuedAt,
            leaseExpiresAt: new Date(issuedAt.getTime() + 180_000),
        };
        const grant = await issuer.issue(request);
        const renewed = await issuer.issue({ ...request, issuedAt: new Date(issuedAt.getTime() + 60_000) });
        expect(grant.manifestUrl).toBe(renewed.manifestUrl);
        const browserUrl = new URL(grant.manifestUrl);
        expect(browserUrl.origin).toBe('https://stream.example.test');
        expect(browserUrl.pathname).toBe('/v1/hls/approved-v1/live.m3u8');
        expect(browserUrl.searchParams.get('grantId')).toMatch(/^[a-f0-9]{64}$/);
        expect(browserUrl.searchParams.get('grant')).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(grant.manifestUrl).not.toContain('sig=');
        expect(grant.manifestUrl).not.toContain(request.leaseId);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const [controlUrl, init] = fetchMock.mock.calls[0];
        expect(String(controlUrl)).toMatch(/^http:\/\/beacon-stream:8080\/internal\/v1\/listener\/media-grants\/[a-f0-9]{64}$/);
        expect(init.body).not.toContain('listener-1');
        expect(init.body).not.toContain(request.leaseId);
        expect(init.headers['x-beacon-control-signature']).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('fails closed when the private grant registry is unavailable', async () => {
        const issuer = new EnvironmentManifestIssuer({
            NODE_ENV: 'test',
            EARLY_BIRDS_STREAM_ORIGIN: 'https://stream.example.test',
            EARLY_BIRDS_STREAM_CONTROL_ORIGIN: 'http://control.example.test',
            EARLY_BIRDS_STREAM_ARTIFACT_ID: 'approved-v1',
            EARLY_BIRDS_STREAM_SIGNING_SECRET: SECRET,
        } as NodeJS.ProcessEnv, vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
        await expect(issuer.issue({
            accountId: 'listener-1', leaseId: crypto.randomUUID(), leaseGeneration: 1,
            issuedAt: new Date(), leaseExpiresAt: new Date(Date.now() + 60_000),
        })).rejects.toBeInstanceOf(EarlyBirdStreamIssuerUnavailableError);
    });
});
