import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
        },
    },
    test: {
        environment: 'node',
        setupFiles: ['src/__tests__/setup.ts'],
        include: ['src/**/*.test.{ts,tsx}', 'middleware.test.ts'],
        coverage: {
            provider: 'v8',
            include: ['src/lib/**', 'src/app/api/**', 'src/components/**', 'src/context/**'],
            exclude: ['**/__tests__/**', '**/*.test.*'],
        },
    },
});
