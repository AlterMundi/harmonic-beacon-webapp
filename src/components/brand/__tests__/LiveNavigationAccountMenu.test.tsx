// @vitest-environment jsdom

import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const replace = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
    useRouter: () => ({ replace, refresh }),
}));

import {
    LiveNavigationAccountMenu,
    trustedAccountLogoutURL,
} from '../LiveNavigationAccountMenu';

import { LocaleProvider } from '@/context/LocaleContext';
import LanguageControl from '../LanguageControl';
import { RoomExitProvider, useRoomExit } from '@/components/navigation/RoomExitGuard';
function ActiveRoom() { useRoomExit(true); return null; }

function render(ui: React.ReactElement<{ locale?: 'es' | 'en' }>) {
    return rtlRender(ui, { wrapper: ({ children }) => <LocaleProvider initialLocale={ui.props.locale ?? 'en'}>{children}</LocaleProvider> });
}

const ACCOUNT = 'https://account-staging.harmonicbeacon.com/account' as const;
const ISSUER = 'https://account-staging.harmonicbeacon.com';

describe('Live navigation Account menu', () => {
    it('immediately protects the surviving room again when confirmed sign-out fails', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
        render(<LocaleProvider initialLocale="en"><RoomExitProvider><ActiveRoom /><LiveNavigationAccountMenu displayName={null} staffRoleLabel={null} accountHref={ACCOUNT} accountIssuer={ISSUER} locale="en" /></RoomExitProvider></LocaleProvider>);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
        fireEvent.click(screen.getByRole('button', { name: 'Leave the room' }));
        await screen.findByRole('alert');
        const unload = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(unload);
        expect(unload.defaultPrevented).toBe(true);
        expect(replace).not.toHaveBeenCalled();
    });
    it('does not revoke or navigate until confirmed once; Escape returns to sign-out', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
        vi.stubGlobal('fetch', fetchMock);
        render(<LocaleProvider initialLocale="en"><RoomExitProvider><ActiveRoom /><LiveNavigationAccountMenu displayName={null} staffRoleLabel={null} accountHref={ACCOUNT} accountIssuer={ISSUER} locale="en" /></RoomExitProvider></LocaleProvider>);
        const trigger = screen.getByRole('menuitem', { name: 'Sign out' });
        trigger.focus(); fireEvent.click(trigger);
        expect(fetchMock).not.toHaveBeenCalled();
        fireEvent.keyDown(await screen.findByRole('alertdialog'), { key: 'Escape' });
        expect(trigger).toHaveFocus();
        expect(fetchMock).not.toHaveBeenCalled();
        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('button', { name: 'Leave the room' }));
        await waitFor(() => expect(replace).toHaveBeenCalledOnce());
        expect(fetchMock).toHaveBeenCalledOnce();
    });
    it('updates the staff role rather than retaining a server-translated label', () => {
        render(<LocaleProvider initialLocale="en"><LanguageControl /><LiveNavigationAccountMenu displayName={null} staffRole="ADMIN" staffRoleLabel="Administration" accountHref={ACCOUNT} accountIssuer={ISSUER} locale="en" /></LocaleProvider>);
        fireEvent.click(screen.getByRole('button', { name: 'ES' }));
        expect(screen.getByText('Administración')).toBeVisible();
    });
    it('updates account actions in place with the live locale', () => {
        render(<LocaleProvider initialLocale="en"><LanguageControl /><LiveNavigationAccountMenu displayName={null} staffRoleLabel={null} accountHref={ACCOUNT} accountIssuer={ISSUER} locale="en" /></LocaleProvider>);
        fireEvent.click(screen.getByRole('button', { name: 'ES' }));
        expect(screen.getByRole('menuitem', { name: 'Cerrar sesión' })).toBeVisible();
        expect(screen.getByRole('menuitem', { name: 'Cuenta' })).toHaveAttribute('href', `${ACCOUNT}?lang=es`);
    });
    afterEach(() => {
        cleanup();
        localStorage.clear();
        document.cookie = 'hb_locale=; Path=/; Max-Age=0';
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('keeps the signed-in menu compact and adds Operations only for staff', () => {
        const { rerender } = render(<LiveNavigationAccountMenu
            displayName="Nicolás Echániz"
            staffRoleLabel="Administración"
            accountHref={ACCOUNT} accountIssuer={ISSUER}
            locale="es"
        />);

        expect(screen.getByText('Nicolás Echániz')).toBeInTheDocument();
        expect(screen.getByText('Administración')).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Cuenta' }))
            .toHaveAttribute('href', `${ACCOUNT}?lang=es`);
        expect(screen.getByRole('menuitem', { name: 'Operaciones' }))
            .toHaveAttribute('href', '/ops/events');
        expect(screen.getByRole('menuitem', { name: 'Cerrar sesión' })).toBeInTheDocument();
        expect(document.body).not.toHaveTextContent('PayPal');
        expect(document.body).not.toHaveTextContent('USD');

        rerender(<LiveNavigationAccountMenu
            displayName="Founder Test"
            staffRoleLabel={null}
            accountHref={ACCOUNT} accountIssuer={ISSUER}
            locale="en"
        />);
        expect(screen.queryByRole('menuitem', { name: 'Operations' })).toBeNull();
    });

    it('revokes the local session before returning to the public Live landing', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ ok: true }),
        });
        vi.stubGlobal('fetch', fetchMock);
        render(<LiveNavigationAccountMenu
            displayName="Nicolás"
            staffRoleLabel="Administrator"
            accountHref={ACCOUNT} accountIssuer={ISSUER}
            locale="en"
        />);

        fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', {
            method: 'POST',
            headers: { Accept: 'application/json' },
        }));
        expect(replace).toHaveBeenCalledWith('/');
        expect(refresh).toHaveBeenCalled();
    });

    it('shows a retryable error without pretending sign-out succeeded', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
        render(<LiveNavigationAccountMenu
            displayName={null}
            staffRoleLabel={null}
            accountHref={ACCOUNT} accountIssuer={ISSUER}
            locale="en"
        />);

        fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('We could not sign you out');
        expect(replace).not.toHaveBeenCalled();
    });

    it.each([
        ['https://account-staging.harmonicbeacon.com/account/logout?initiation=opaque', ISSUER, true],
        ['https://127.0.0.1:3410/account/logout?initiation=opaque', 'https://127.0.0.1:3410', true],
        ['https://account-staging.harmonicbeacon.com/api/account/auth/oauth2/end-session?state=opaque', ISSUER, false],
        ['https://account.harmonicbeacon.com/account/logout', ISSUER, false],
        ['https://account-staging.harmonicbeacon.com/account/logout', 'https://account.harmonicbeacon.com', false],
        ['https://account-staging.harmonicbeacon.com/account', ISSUER, false],
        ['https://account-staging.harmonicbeacon.com.evil.example/logout', ISSUER, false],
        ['javascript:alert(1)', ISSUER, false],
        ['not a URL', ISSUER, false],
        ['https://account-staging.harmonicbeacon.com/account/logout', 'not an issuer', false],
    ])('validates the Account logout destination %s against issuer %s', (raw, issuer, accepted) => {
        expect(Boolean(trustedAccountLogoutURL(raw, issuer))).toBe(accepted);
    });
});
