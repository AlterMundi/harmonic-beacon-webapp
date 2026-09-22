// @vitest-environment jsdom

import { useEffect } from 'react';
import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const replace = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
const navigation = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({
    useRouter: () => ({ replace, refresh }),
    usePathname: () => navigation.pathname,
}));

import {
    LiveNavigationAccountMenu,
    scheduledSessionIdFromPathname,
    trustedAccountLogoutURL,
} from '../LiveNavigationAccountMenu';

import { LocaleProvider } from '@/context/LocaleContext';
import LanguageControl from '../LanguageControl';
import { RoomExitProvider, useRoomExit } from '@/components/navigation/RoomExitGuard';
function ActiveRoom() { useRoomExit(true); return null; }
function ActiveMedia({ onUnmount }: { onUnmount: () => void }) {
    useEffect(() => onUnmount, [onUnmount]);
    return <div data-testid="active-media" />;
}

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
        navigation.pathname = '/';
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

    it('edits an attendee room alias in place without navigation, exit confirmation, or media unmount', async () => {
        navigation.pathname = '/session/event-1';
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    identity: { kind: 'attendee', displayName: 'Preferred name', confirmed: true },
                    session: { id: 'event-1' },
                }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ displayName: 'Room alias', confirmed: true }),
            });
        vi.stubGlobal('fetch', fetchMock);
        const onUnmount = vi.fn();
        render(<RoomExitProvider>
            <ActiveRoom />
            <ActiveMedia onUnmount={onUnmount} />
            <LiveNavigationAccountMenu
                displayName="Preferred name"
                staffRoleLabel={null}
                accountHref={ACCOUNT} accountIssuer={ISSUER}
                locale="en"
            />
        </RoomExitProvider>);

        expect(fetchMock).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Edit your name in this room' }));
        const input = await screen.findByRole('textbox', { name: 'Name in this room' });
        fireEvent.change(input, { target: { value: 'Room alias' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByRole('status')).toHaveTextContent('Name updated.');
        expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/scheduled-sessions/event-1/entry',
            expect.objectContaining({ method: 'GET' }));
        expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/scheduled-sessions/event-1/entry',
            expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ displayName: 'Room alias' }) }));
        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect(screen.getByTestId('active-media')).toBeInTheDocument();
        expect(onUnmount).not.toHaveBeenCalled();
        expect(replace).not.toHaveBeenCalled();
        expect(refresh).not.toHaveBeenCalled();
    });

    it('shows alias editing only for attendee room paths and follows the live locale', () => {
        navigation.pathname = '/events';
        const { rerender } = render(<LiveNavigationAccountMenu
            displayName="Ana" staffRoleLabel={null}
            accountHref={ACCOUNT} accountIssuer={ISSUER} locale="en"
        />);
        expect(screen.queryByRole('menuitem', { name: 'Edit your name in this room' })).toBeNull();

        navigation.pathname = '/session/event-1';
        rerender(<LiveNavigationAccountMenu
            displayName="Ana" staffRoleLabel="Facilitator"
            accountHref={ACCOUNT} accountIssuer={ISSUER} locale="en"
        />);
        expect(screen.queryByRole('menuitem', { name: 'Edit your name in this room' })).toBeNull();

        rerender(<LocaleProvider initialLocale="es"><LiveNavigationAccountMenu
            displayName="Ana" staffRoleLabel={null}
            accountHref={ACCOUNT} accountIssuer={ISSUER} locale="es"
        /></LocaleProvider>);
        expect(screen.getByRole('menuitem', { name: 'Editar nombre en la sala' })).toBeVisible();
        expect(screen.getAllByRole('menuitem')).toHaveLength(3);
    });

    it.each([
        ['/session/event-1', 'event-1'],
        ['/session/event%20one', 'event one'],
        ['/session/event-1/', 'event-1'],
        ['/session/', null],
        ['/session/event-1/extra', null],
        ['/ops/session/event-1', null],
        ['/session/%2F', null],
        ['/session/%E0%A4%A', null],
    ])('resolves attendee session path %s without broadening the menu', (pathname, expected) => {
        expect(scheduledSessionIdFromPathname(pathname)).toBe(expected);
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
