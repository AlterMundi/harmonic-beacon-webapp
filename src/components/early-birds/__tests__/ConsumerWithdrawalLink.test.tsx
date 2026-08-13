// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
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

    it('does not cover the request itself with a self-link', () => {
        usePathname.mockReturnValue('/listener/withdrawal');
        render(<LocaleProvider initialLocale="es"><ConsumerWithdrawalLink /></LocaleProvider>);
        expect(screen.queryByRole('link')).toBeNull();
    });
});
