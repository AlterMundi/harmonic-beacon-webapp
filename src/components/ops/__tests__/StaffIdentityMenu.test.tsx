// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const replace = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
    useRouter: () => ({ replace, refresh }),
}));

import StaffIdentityMenu from '../StaffIdentityMenu';

describe('StaffIdentityMenu', () => {
    it('shows a real identity and revokes the session before leaving', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', fetchMock);

        render(
            <StaffIdentityMenu
                name="Julián"
                roleLabel="Facilitación y operaciones"
                signedInAs="Sesión de equipo"
                signOut="Cerrar sesión"
            />,
        );
        expect(screen.getAllByText('Julián')).toHaveLength(2);
        expect(screen.getAllByText('Facilitación y operaciones')).toHaveLength(2);

        fireEvent.click(document.querySelector('summary')!);
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' }));
        expect(replace).toHaveBeenCalledWith('/staff/login');
        expect(refresh).toHaveBeenCalled();
    });
});
