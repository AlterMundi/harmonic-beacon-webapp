// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/context/LocaleContext';

const usePathname = vi.hoisted(() => vi.fn(() => '/listener'));
vi.mock('next/navigation', () => ({ usePathname }));

import ConsumerWithdrawalLink from '../ConsumerWithdrawalLink';

afterEach(() => cleanup());

describe('prominent consumer-withdrawal entry', () => {
    it.each(['es', 'en'] as const)('keeps the legally named no-login link visible in %s', (locale) => {
        usePathname.mockReturnValue('/listener');
        render(<LocaleProvider initialLocale={locale}><ConsumerWithdrawalLink /></LocaleProvider>);
        const link = screen.getByRole('link', { name: /BOTÓN DE ARREPENTIMIENTO/ });
        expect(link).toHaveAttribute('href', '/listener/withdrawal');
        expect(link).toHaveClass('listener-withdrawal-link');
    });

    it('exposes the separately named no-login service cancellation link', () => {
        usePathname.mockReturnValue('/listener');
        render(<LocaleProvider initialLocale="es"><ConsumerWithdrawalLink kind="SERVICE_CANCELLATION" /></LocaleProvider>);
        expect(screen.getByRole('link', { name: /BOTÓN DE BAJA DE SERVICIO/ }))
            .toHaveAttribute('href', '/listener/cancel-service');
    });

    it('does not cover the request itself with a self-link', () => {
        usePathname.mockReturnValue('/listener/withdrawal');
        render(<LocaleProvider initialLocale="es"><ConsumerWithdrawalLink /></LocaleProvider>);
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('keeps mobile consumer actions in document flow after Listener content', () => {
        const root = process.cwd();
        const layout = readFileSync(join(root, 'src/app/listener/layout.tsx'), 'utf8');
        const css = readFileSync(join(root, 'src/app/globals.css'), 'utf8');

        expect(layout.indexOf('{children}')).toBeGreaterThan(-1);
        expect(layout.indexOf('{children}')).toBeLessThan(
            layout.indexOf('className="listener-consumer-request-links"'),
        );
        expect(css).toMatch(
            /@media \(max-width: 640px\)[\s\S]*?\.listener-consumer-request-links\s*\{[\s\S]*?position:\s*static;/,
        );
    });
});
