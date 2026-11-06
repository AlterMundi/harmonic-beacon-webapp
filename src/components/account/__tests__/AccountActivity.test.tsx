// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AccountListeningCard, type AccountHome } from '../AccountActivity';

const home: AccountHome = { identityKey: 'own-subject', listenerOrigin: 'https://listen.harmonicbeacon.com' };
const data = { version: 1, identityKey: home.identityKey, listeningSeconds: 5400, membership: { kind: 'founder', state: 'active' } };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('shows measured time and a confirmed plan only for the same Account subject', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(data)); vi.stubGlobal('fetch', fetchMock);
    render(<AccountListeningCard home={home} locale="en" />);
    expect(await screen.findByText('Plus · Founding Listener')).toBeInTheDocument();
    expect(screen.getByText('hours').parentElement).toHaveTextContent('1.5 hours');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include', cache: 'no-store' });
});

it('hides another Listener identity and never presents its paid plan or hours', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...data, identityKey: 'other-person' })));
    render(<AccountListeningCard home={home} locale="en" />);
    expect(await screen.findByText(/Sign in to Listen with this account/)).toBeInTheDocument();
    expect(screen.queryByText(/Founding Listener/)).not.toBeInTheDocument();
    expect(screen.queryByText('hours')).not.toBeInTheDocument();
});

it('immediately hides a former identity and ignores its late response after account change', async () => {
    let resolveFirst!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
        .mockResolvedValueOnce(Response.json({ ...data, identityKey: 'new-person', listeningSeconds: 0, membership: { kind: 'none', state: 'none' } })));
    const { rerender } = render(<AccountListeningCard home={home} locale="en" />);
    rerender(<AccountListeningCard home={{ ...home, identityKey: 'new-person' }} locale="en" />);
    expect(await screen.findByText('Free')).toBeInTheDocument();
    await act(async () => resolveFirst(Response.json(data)));
    expect(screen.queryByText(/Founding Listener/)).not.toBeInTheDocument();
    expect(screen.getByText('hours').parentElement).toHaveTextContent('0 hours');
});

it.each([null, -1, 1.5, '100'])('handles unavailable or invalid measured time (%s) without fabricating zero', async listeningSeconds => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...data, listeningSeconds })));
    render(<AccountListeningCard home={home} locale="en" />);
    await waitFor(() => expect(screen.queryByText(/Loading your hours/)).not.toBeInTheDocument());
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    if (listeningSeconds === null) expect(screen.getByText(/Listening records are currently unavailable/)).toBeInTheDocument();
    else expect(screen.getByRole('status')).toHaveTextContent(/currently unavailable/);
});

it('does not turn an expired session or a service failure into a Free membership', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    render(<AccountListeningCard home={home} locale="es" />);
    expect(await screen.findByText(/Ingresá a Listen con esta misma cuenta/)).toBeInTheDocument();
    expect(screen.queryByText('Gratis')).not.toBeInTheDocument();
});
