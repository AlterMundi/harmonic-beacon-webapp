import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { expect, test } from '@playwright/test';

const execFileAsync = promisify(execFile);
const STREAM_ORIGIN = 'https://stream.e2e.invalid';
const MEDIA_SEGMENT_SECONDS = 6;
const SOURCE_FIXTURE_SEGMENTS = 240;
const SOURCE_WINDOW_SEGMENTS = 50;
const SOURCE_PROGRAM_EPOCH_MS = Date.parse('2026-08-20T00:00:00.000Z');
// Browsers may retain a sub-frame tail in TimeRanges after the decoder clock
// has genuinely stalled. Half a second is still two orders of magnitude below
// the promised reservoir and prevents pretending that millisecond rounding is
// audible continuity.
const EXHAUSTED_MEDIA_TOLERANCE_SECONDS = 0.5;

type HlsFixture = {
    root: string;
    initialization: string;
    segments: string[];
};

async function createHlsFixture(): Promise<HlsFixture> {
    const root = await mkdtemp(path.join(tmpdir(), 'hb-listener-network-'));
    await execFileAsync('ffmpeg', [
        '-hide_banner',
        '-loglevel', 'error',
        '-f', 'lavfi',
        '-i', 'sine=frequency=440:sample_rate=48000',
        '-t', String(MEDIA_SEGMENT_SECONDS * SOURCE_FIXTURE_SEGMENTS),
        '-c:a', 'aac',
        '-b:a', '64k',
        '-f', 'hls',
        '-hls_time', String(MEDIA_SEGMENT_SECONDS),
        '-hls_list_size', '0',
        '-hls_segment_type', 'fmp4',
        '-hls_fmp4_init_filename', 'init.mp4',
        '-hls_segment_filename', path.join(root, '%05d.m4s'),
        path.join(root, 'source.m3u8'),
    ]);
    const manifest = await readFile(path.join(root, 'source.m3u8'), 'utf8');
    const initialization = /#EXT-X-MAP:URI="([^"]+)"/.exec(manifest)?.[1];
    const generatedSegments = manifest.split('\n').filter((line) => /^\d{5}\.m4s$/.test(line));
    // ffmpeg may emit one final encoder-drain fragment after the requested
    // boundary. Keep a monotonic 24-minute source behind the rolling 5-minute
    // manifest so a slower CI runner never wraps media timestamps mid-outage.
    const segments = generatedSegments.slice(0, SOURCE_FIXTURE_SEGMENTS);
    if (!initialization || segments.length !== SOURCE_FIXTURE_SEGMENTS) {
        throw new Error(`unexpected HLS fixture inventory: ${generatedSegments.length}`);
    }
    return { root, initialization, segments };
}

function renderLiveManifest(fixture: HlsFixture, edgeSequence: number): string {
    const firstSequence = Math.max(0, edgeSequence - (SOURCE_WINDOW_SEGMENTS - 1));
    const lines = [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        `#EXT-X-TARGETDURATION:${MEDIA_SEGMENT_SECONDS}`,
        '#EXT-X-DISCONTINUITY-SEQUENCE:0',
        `#EXT-X-MEDIA-SEQUENCE:${firstSequence}`,
        '#EXT-X-INDEPENDENT-SEGMENTS',
        `#EXT-X-MAP:URI="${fixture.initialization}"`,
    ];
    for (let sequence = firstSequence; sequence <= edgeSequence; sequence += 1) {
        const index = sequence;
        if (!fixture.segments[index]) break;
        lines.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date(
            SOURCE_PROGRAM_EPOCH_MS + sequence * MEDIA_SEGMENT_SECONDS * 1_000,
        ).toISOString()}`);
        lines.push(`#EXTINF:${MEDIA_SEGMENT_SECONDS.toFixed(6)},`);
        lines.push(fixture.segments[index]);
    }
    return `${lines.join('\n')}\n`;
}

async function mediaState(page: import('@playwright/test').Page) {
    return page.locator('audio[aria-label="Beacon"]').evaluate((media: HTMLAudioElement) => {
        let bufferedAheadSeconds = 0;
        for (let index = 0; index < media.buffered.length; index += 1) {
            const start = media.buffered.start(index);
            const end = media.buffered.end(index);
            if (media.currentTime >= start - 0.25 && media.currentTime <= end + 0.25) {
                bufferedAheadSeconds = Math.max(0, end - media.currentTime);
                break;
            }
        }
        return {
            currentTime: media.currentTime,
            bufferedAheadSeconds,
            paused: media.paused,
            ended: media.ended,
            readyState: media.readyState,
            errorCode: media.error?.code ?? null,
            playbackRate: media.playbackRate,
        };
    });
}

async function retainedReservoirSeconds(page: import('@playwright/test').Page): Promise<number> {
    return page.evaluate(() => {
        const diagnostics = (window as typeof window & { __hbNetworkDiagnostics?: unknown[] })
            .__hbNetworkDiagnostics ?? [];
        let retainedSeconds = 0;
        for (const diagnostic of diagnostics) {
            if (!diagnostic || typeof diagnostic !== 'object') continue;
            const value = (diagnostic as { reservoirAheadSeconds?: unknown }).reservoirAheadSeconds;
            if (typeof value === 'number' && Number.isFinite(value)) {
                retainedSeconds = value;
            }
        }
        return retainedSeconds;
    });
}

async function availablePlaybackSeconds(page: import('@playwright/test').Page): Promise<number> {
    const [media, retained] = await Promise.all([
        mediaState(page),
        retainedReservoirSeconds(page),
    ]);
    return media.bufferedAheadSeconds + retained;
}

async function waitForAvailablePlaybackSeconds(
    page: import('@playwright/test').Page,
    minimumSeconds: number,
    timeout: number,
    message: string,
): Promise<void> {
    try {
        await page.waitForFunction((minimum) => {
            const media = document.querySelector<HTMLAudioElement>('audio[aria-label="Beacon"]');
            if (!media) return false;
            let bufferedAheadSeconds = 0;
            for (let index = 0; index < media.buffered.length; index += 1) {
                const start = media.buffered.start(index);
                const end = media.buffered.end(index);
                if (media.currentTime >= start - 0.25 && media.currentTime <= end + 0.25) {
                    bufferedAheadSeconds = Math.max(0, end - media.currentTime);
                    break;
                }
            }
            const diagnostics = (window as typeof window & { __hbNetworkDiagnostics?: unknown[] })
                .__hbNetworkDiagnostics ?? [];
            let retainedSeconds = 0;
            for (const diagnostic of diagnostics) {
                if (!diagnostic || typeof diagnostic !== 'object') continue;
                const value = (diagnostic as { reservoirAheadSeconds?: unknown })
                    .reservoirAheadSeconds;
                if (typeof value === 'number' && Number.isFinite(value)) retainedSeconds = value;
            }
            return bufferedAheadSeconds + retainedSeconds >= minimum;
        }, minimumSeconds, { timeout, polling: 250 });
    } catch (error) {
        const evidence = await page.evaluate(() => {
            const media = document.querySelector<HTMLAudioElement>('audio[aria-label="Beacon"]');
            const diagnostics = (window as typeof window & { __hbNetworkDiagnostics?: unknown[] })
                .__hbNetworkDiagnostics ?? [];
            return {
                currentTime: media?.currentTime ?? null,
                readyState: media?.readyState ?? null,
                errorCode: media?.error?.code ?? null,
                retainedSeconds: diagnostics.reduce((latest, diagnostic) => {
                    if (!diagnostic || typeof diagnostic !== 'object') return latest;
                    const value = (diagnostic as { reservoirAheadSeconds?: unknown })
                        .reservoirAheadSeconds;
                    return typeof value === 'number' && Number.isFinite(value) ? value : latest;
                }, 0),
                recent: diagnostics.slice(-8).map((diagnostic) => {
                    if (!diagnostic || typeof diagnostic !== 'object') return null;
                    const record = diagnostic as {
                        reason?: unknown;
                        action?: unknown;
                        reservoirAheadSeconds?: unknown;
                        media?: { bufferedAheadSeconds?: unknown };
                        hls?: { type?: unknown; details?: unknown; fatal?: unknown };
                    };
                    return {
                        reason: record.reason,
                        action: record.action,
                        reservoirAheadSeconds: record.reservoirAheadSeconds,
                        bufferedAheadSeconds: record.media?.bufferedAheadSeconds,
                        hlsType: record.hls?.type,
                        hlsDetails: record.hls?.details,
                        hlsFatal: record.hls?.fatal,
                    };
                }),
            };
        });
        throw new Error(`${message}: ${JSON.stringify(evidence)}`, { cause: error });
    }
}

async function reservoirSnapshotCount(page: import('@playwright/test').Page): Promise<number> {
    return page.evaluate(() => (
        ((window as typeof window & { __hbNetworkDiagnostics?: Array<{ reason?: unknown }> })
            .__hbNetworkDiagnostics ?? [])
            .filter((diagnostic) => diagnostic?.reason === 'reservoir-ready').length
    ));
}

async function lastRecoveryBufferedAheadSeconds(
    page: import('@playwright/test').Page,
): Promise<number | null> {
    return page.evaluate(() => {
        const diagnostics = (window as typeof window & { __hbNetworkDiagnostics?: unknown[] })
            .__hbNetworkDiagnostics ?? [];
        for (let index = diagnostics.length - 1; index >= 0; index -= 1) {
            const diagnostic = diagnostics[index];
            if (!diagnostic || typeof diagnostic !== 'object') continue;
            const record = diagnostic as {
                reason?: unknown;
                media?: { bufferedAheadSeconds?: unknown };
            };
            if (![
                'media-clock-stalled',
                'paused-unexpectedly',
                'ended-unexpectedly',
                'media-error',
            ].includes(String(record.reason))) continue;
            const value = record.media?.bufferedAheadSeconds;
            return typeof value === 'number' && Number.isFinite(value) ? value : null;
        }
        return null;
    });
}

test.describe('Listener network resilience', () => {
    test.skip(process.env.E2E_LISTENER_NETWORK_GATE !== '1', 'focused network gate is opt-in');
    test.slow();

    let fixture: HlsFixture;

    test.beforeAll(async () => {
        fixture = await createHlsFixture();
    });

    test.afterAll(async () => {
        if (fixture?.root) await rm(fixture.root, { recursive: true, force: true });
    });

    test('preserves the filled buffer through outages and refills without a new lease', async ({
        page,
        browserName,
    }, testInfo) => {
        test.setTimeout(browserName === 'webkit' ? 600_000 : 480_000);
        let sourceElapsedMediaSeconds = 0;
        let sourceClockUpdatedAt = Date.now();
        let sourcePlaybackRate = 1;
        // Keep the synthetic live edge aligned with the listener clock. A
        // permanently 4x origin makes a slow decoder fall out of the rolling
        // window before the test has even enabled accelerated playback.
        const currentSourceElapsedMediaSeconds = () => (
            sourceElapsedMediaSeconds
            + (Date.now() - sourceClockUpdatedAt) / 1_000 * sourcePlaybackRate
        );
        const setSourcePlaybackRate = (nextRate: number) => {
            sourceElapsedMediaSeconds = currentSourceElapsedMediaSeconds();
            sourceClockUpdatedAt = Date.now();
            sourcePlaybackRate = nextRate;
        };
        let originOnline = true;
        let originDelayMs = 0;
        let failEveryMediaRequest = 0;
        let leaseRequests = 0;
        let heartbeatRequests = 0;
        let manifestRequests = 0;
        let mediaRequests = 0;
        const diagnosticEvents: unknown[] = [];

        await page.addInitScript(() => {
            (window as typeof window & { __hbNetworkDiagnostics?: unknown[] })
                .__hbNetworkDiagnostics = [];
            window.addEventListener('listener:playback-diagnostic', (event) => {
            (window as typeof window & { __hbNetworkDiagnostics: unknown[] })
                .__hbNetworkDiagnostics.push((event as CustomEvent).detail);
            const diagnostics = (window as typeof window & { __hbNetworkDiagnostics: unknown[] })
                .__hbNetworkDiagnostics;
            if (diagnostics.length > 256) diagnostics.splice(0, diagnostics.length - 256);
            });
        });
        await page.route(`${STREAM_ORIGIN}/**`, async (route) => {
            if (!originOnline) {
                await route.abort('internetdisconnected');
                return;
            }
            const url = new URL(route.request().url());
            const file = path.basename(url.pathname);
            if (file === 'live.m3u8') {
                manifestRequests += 1;
                const elapsedMediaSeconds = currentSourceElapsedMediaSeconds();
                const edgeSequence = Math.min(
                    SOURCE_FIXTURE_SEGMENTS - 1,
                    SOURCE_WINDOW_SEGMENTS - 1
                        + Math.floor(elapsedMediaSeconds / MEDIA_SEGMENT_SECONDS),
                );
                await route.fulfill({
                    status: 200,
                    contentType: 'application/vnd.apple.mpegurl',
                    headers: {
                        'access-control-allow-origin': '*',
                        'cache-control': 'no-store',
                    },
                    body: renderLiveManifest(fixture, edgeSequence),
                });
                return;
            }
            const safeFile = file === fixture.initialization || fixture.segments.includes(file);
            if (!safeFile) {
                await route.fulfill({ status: 404, body: '' });
                return;
            }
            mediaRequests += 1;
            if (failEveryMediaRequest > 0 && mediaRequests % failEveryMediaRequest === 0) {
                await route.abort('connectionreset');
                return;
            }
            if (originDelayMs > 0) {
                const deterministicJitterMs = (mediaRequests % 5) * 75;
                await new Promise((resolve) => setTimeout(resolve, originDelayMs + deterministicJitterMs));
            }
            await route.fulfill({
                status: 200,
                contentType: file.endsWith('.mp4') ? 'video/mp4' : 'video/iso.segment',
                headers: {
                    'access-control-allow-origin': '*',
                    'cache-control': 'public, max-age=31536000, immutable',
                },
                body: await readFile(path.join(fixture.root, file)),
            });
        });

        const lease = {
            leaseId: '00000000-0000-4000-8000-000000000419',
            leaseGeneration: 1,
            presenceSequence: 0,
            leaseExpiresAt: '2099-08-20T23:59:00.000Z',
            stream: {
                manifestUrl: `${STREAM_ORIGIN}/approved/live.m3u8?grantId=${'a'.repeat(64)}&grant=${'b'.repeat(43)}`,
                expiresAt: '2099-08-20T23:59:00.000Z',
            },
        };
        await page.route('**/api/early-birds/stream/lease', async (route) => {
            leaseRequests += 1;
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(lease) });
        });
        await page.route('**/api/early-birds/stream/heartbeat', async (route) => {
            heartbeatRequests += 1;
            const body = route.request().postDataJSON() as { presenceSequence?: number } | null;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    ...lease,
                    presenceSequence: body?.presenceSequence ?? 0,
                }),
            });
        });

        await page.goto('/early-birds');
        const listen = page.getByRole('button', { name: /Listen|Escuchar/ });
        await expect(listen).toBeEnabled({ timeout: 20_000 });
        await listen.click();
        await expect(page.getByRole('button', { name: /Stop|Detener/ })).toBeVisible();

        await waitForAvailablePlaybackSeconds(
            page,
            180,
            90_000,
            `${browserName} did not fill the promised Listener buffer`,
        );
        await expect.poll(async () => (await mediaState(page)).bufferedAheadSeconds, {
            timeout: 20_000,
            message: `${browserName} did not make retained audio immediately playable`,
        }).toBeGreaterThan(5);
        const achievedBufferSeconds = await availablePlaybackSeconds(page);
        await page.locator('audio[aria-label="Beacon"]').evaluate((media: HTMLAudioElement) => {
            media.playbackRate = 4;
        });
        setSourcePlaybackRate(4);

        const outageDurations = [5, 15, 30, 60];
        for (const outageMediaSeconds of outageDurations) {
            const before = await mediaState(page);
            originOnline = false;
            await expect.poll(async () => (await mediaState(page)).currentTime - before.currentTime, {
                timeout: Math.ceil(outageMediaSeconds / 4 * 1_000) + 15_000,
                message: `${browserName} stopped inside a ${outageMediaSeconds}s buffered outage`,
            }).toBeGreaterThanOrEqual(outageMediaSeconds);
            const during = await mediaState(page);
            expect(during.paused).toBe(false);
            expect(during.ended).toBe(false);
            expect(during.errorCode).toBeNull();
            await expect(page.getByRole('button', { name: /Stop|Detener/ })).toBeVisible();

            originOnline = true;
            const snapshotsBeforeRefill = await reservoirSnapshotCount(page);
            const manifestsBeforeRefill = manifestRequests;
            await page.evaluate(() => window.dispatchEvent(new Event('online')));
            await expect.poll(() => manifestRequests, {
                timeout: 20_000,
                message: `${browserName} did not refresh its manifest after reconnecting`,
            }).toBeGreaterThan(manifestsBeforeRefill);
            await expect.poll(async () => reservoirSnapshotCount(page), {
                timeout: 30_000,
                message: `${browserName} did not complete a reservoir refill`,
            }).toBeGreaterThan(snapshotsBeforeRefill);
            await waitForAvailablePlaybackSeconds(
                page,
                180,
                45_000,
                `${browserName} did not refill after a ${outageMediaSeconds}s outage`,
            );
            await expect(page.locator('.listener-experience[data-phase="beacon"]'))
                .toBeVisible({ timeout: 20_000 });
        }

        // Latency, deterministic jitter and intermittent segment loss must
        // consume/refill the same buffer without replacing the lease.
        await page.locator('audio[aria-label="Beacon"]').evaluate((media: HTMLAudioElement) => {
            media.playbackRate = 1;
        });
        setSourcePlaybackRate(1);
        originDelayMs = 250;
        failEveryMediaRequest = 9;
        const degradedStarted = (await mediaState(page)).currentTime;
        await expect.poll(async () => (await mediaState(page)).currentTime - degradedStarted, {
            timeout: 35_000,
            message: `${browserName} stopped under latency, jitter and intermittent loss`,
        }).toBeGreaterThanOrEqual(15);
        expect((await mediaState(page)).paused).toBe(false);
        originDelayMs = 0;
        failEveryMediaRequest = 0;
        const degradedSnapshots = await reservoirSnapshotCount(page);
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect.poll(async () => reservoirSnapshotCount(page), { timeout: 30_000 })
            .toBeGreaterThan(degradedSnapshots);
        await page.locator('audio[aria-label="Beacon"]').evaluate((media: HTMLAudioElement) => {
            media.playbackRate = 4;
        });
        setSourcePlaybackRate(4);
        await waitForAvailablePlaybackSeconds(
            page,
            180,
            45_000,
            `${browserName} did not refill after degraded connectivity`,
        );

        // Exercise an outage ten seconds below the promised three-minute
        // target. The MediaSource and reservoir counters are intentionally
        // separate and may briefly overstate what the decoder can consume, so
        // never turn their sum into a larger product promise here.
        const nearLimit = await mediaState(page);
        const availableNearLimitSeconds = await availablePlaybackSeconds(page);
        const nearLimitOutageSeconds = Math.max(
            60,
            Math.min(170, Math.floor(availableNearLimitSeconds - 10)),
        );
        originOnline = false;
        await expect.poll(async () => (await mediaState(page)).currentTime - nearLimit.currentTime, {
            timeout: Math.ceil(nearLimitOutageSeconds / 4 * 1_000) + 20_000,
            message: `${browserName} did not preserve playback near its measured buffer limit`,
        }).toBeGreaterThanOrEqual(nearLimitOutageSeconds);
        expect((await mediaState(page)).paused).toBe(false);
        originOnline = true;
        const nearLimitSnapshots = await reservoirSnapshotCount(page);
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect.poll(async () => reservoirSnapshotCount(page), { timeout: 30_000 })
            .toBeGreaterThan(nearLimitSnapshots);
        await waitForAvailablePlaybackSeconds(
            page,
            180,
            60_000,
            `${browserName} did not refill after its near-limit outage`,
        );
        await expect(page.locator('.listener-experience[data-phase="beacon"]'))
            .toBeVisible({ timeout: 20_000 });

        // Once the measured buffer is genuinely exhausted the UI may switch
        // to reconnecting, but it must keep trying and resume without a new
        // lease or a manual reload when the origin returns.
        const beforeExhaustion = await mediaState(page);
        const retainedBeforeExhaustion = await retainedReservoirSeconds(page);
        const rateProbeStartedAt = Date.now();
        await page.waitForTimeout(2_000);
        const rateProbeEnded = await mediaState(page);
        expect(rateProbeEnded.paused).toBe(false);
        expect(rateProbeEnded.currentTime - beforeExhaustion.currentTime).toBeGreaterThan(0.5);
        const effectivePlaybackRate = Math.max(
            0.5,
            Math.min(
                4,
                (rateProbeEnded.currentTime - beforeExhaustion.currentTime)
                    / ((Date.now() - rateProbeStartedAt) / 1_000),
            ),
        );
        originOnline = false;
        const exhaustionDeadline = Date.now()
            // MediaSource and the memory reservoir can hold partially distinct
            // fragments. Their sum is a conservative upper bound; using only
            // the larger value races WebKit while it is still consuming valid
            // bytes from the other layer.
            + Math.ceil((
                beforeExhaustion.bufferedAheadSeconds
                + retainedBeforeExhaustion
            ) / effectivePlaybackRate * 1_000)
            + 60_000;
        let maxCurrentTime = rateProbeEnded.currentTime;
        let exhaustedState: Awaited<ReturnType<typeof mediaState>> | null = null;
        while (Date.now() < exhaustionDeadline) {
            const state = await mediaState(page);
            maxCurrentTime = Math.max(maxCurrentTime, state.currentTime);
            const phase = await page.locator('.listener-experience').getAttribute('data-phase');
            if (phase === 'reconnecting') {
                exhaustedState = state;
                break;
            }
            await page.waitForTimeout(250);
        }
        expect(exhaustedState, `${browserName} did not enter reconnecting after exhausting retained audio`)
            .not.toBeNull();
        expect(await lastRecoveryBufferedAheadSeconds(page))
            .toBeLessThanOrEqual(EXHAUSTED_MEDIA_TOLERANCE_SECONDS);
        expect(maxCurrentTime - beforeExhaustion.currentTime)
            .toBeGreaterThanOrEqual(Math.max(0, beforeExhaustion.bufferedAheadSeconds - 5));
        await expect(page.locator('.listener-experience[data-phase="reconnecting"]'))
            .toBeVisible();
        const reconnectingObservedAt = Date.now();
        await expect(page.getByText(/unavailable right now|no está disponible/i)).toHaveCount(0);

        // An OS/browser `online` event is only advisory: captive portals and
        // partial network recovery can emit it while the stream origin remains
        // unreachable. It must not rebuild MediaSource, reset currentTime or
        // mint a replacement lease before the bounded manifest probe succeeds.
        const beforeAdvisoryOnline = await mediaState(page);
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await page.waitForTimeout(2_500);
        await expect(page.locator('.listener-experience[data-phase="reconnecting"]'))
            .toBeVisible();
        const afterAdvisoryOnline = await mediaState(page);
        expect(afterAdvisoryOnline.currentTime)
            .toBeGreaterThanOrEqual(beforeAdvisoryOnline.currentTime - 1);
        expect(leaseRequests).toBe(1);

        originOnline = true;
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect(page.locator('.listener-experience[data-phase="beacon"]'))
            .toBeVisible({ timeout: 45_000 });
        await expect(page.getByRole('button', { name: /Stop|Detener/ })).toBeVisible();
        const resumedAt = (await mediaState(page)).currentTime;
        await expect.poll(async () => (await mediaState(page)).currentTime, {
            timeout: 20_000,
            message: `${browserName} did not resume its media clock after exhaustion`,
        }).toBeGreaterThan(resumedAt + 2);
        const recoveredAt = Date.now();

        expect(leaseRequests).toBe(1);
        expect(heartbeatRequests).toBeGreaterThan(0);
        expect(manifestRequests).toBeGreaterThan(1);
        expect(mediaRequests).toBeGreaterThanOrEqual(30);
        diagnosticEvents.push(...await page.evaluate(() => (
            (window as typeof window & { __hbNetworkDiagnostics?: unknown[] })
                .__hbNetworkDiagnostics ?? []
        )));
        expect(diagnosticEvents.length).toBeGreaterThan(0);
        expect(JSON.stringify(diagnosticEvents)).not.toMatch(/account|cookie|email|leaseId|token|url/i);
        await testInfo.attach('listener-network-evidence.json', {
            contentType: 'application/json',
            body: Buffer.from(JSON.stringify({
                schemaVersion: 1,
                browserName,
                bufferTargetSeconds: 180,
                achievedBufferSeconds,
                effectivePlaybackRate,
                outageMediaSeconds: outageDurations,
                nearLimitOutageSeconds,
                exhaustionRecoveryMs: Math.max(0, recoveredAt - reconnectingObservedAt),
                leaseRequests,
                heartbeatRequests,
                manifestRequests,
                mediaRequests,
                diagnosticCount: diagnosticEvents.length,
            })),
        });
    });
});
