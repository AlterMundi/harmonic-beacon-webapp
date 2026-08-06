'use client';

import { createAuthClient } from 'better-auth/react';

import { EARLY_BIRD_AUTH_BASE_PATH } from './auth-contract';

export const earlyBirdAuthClient = createAuthClient({
    basePath: EARLY_BIRD_AUTH_BASE_PATH,
});
