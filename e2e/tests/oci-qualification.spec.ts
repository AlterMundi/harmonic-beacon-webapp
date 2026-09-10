import { expect, test } from '@playwright/test';

const expectedSource = process.env.HB_QUALIFICATION_SOURCE_SHA;
const expectedArtifact = process.env.HB_QUALIFICATION_APP_REF;
const expectedConfig = process.env.HB_QUALIFICATION_CONFIG_SHA256;

test('exact digest serves an authenticated synthetic operator session in Chromium', async ({ page, request }) => {
    expect(expectedSource).toMatch(/^[0-9a-f]{40}$/);
    expect(expectedArtifact).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(expectedConfig).toMatch(/^sha256:[0-9a-f]{64}$/);

    const healthResponse = await request.get('/api/health');
    expect(healthResponse.ok()).toBe(true);
    const health = await healthResponse.json();
    expect(health).toMatchObject({
        status: 'ok',
        gitSha: expectedSource,
        artifactDigest: expectedArtifact,
        configProfileSha256: expectedConfig,
    });

    const login = await page.request.post('/api/test-login', {
        data: {
            name: 'OCI Qualification Admin',
            role: 'ADMIN',
            landing: '/ops/health',
            nameConfirmed: true,
        },
    });
    expect(login.ok()).toBe(true);
    await page.goto('/ops/health');
    await expect(page.getByRole('heading', { name: /Event health|Salud del evento/i })).toBeVisible();
});
