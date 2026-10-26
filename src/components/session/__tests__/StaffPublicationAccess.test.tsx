// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/context/LocaleContext';
import StaffPublicationAccess from '../StaffPublicationAccess';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('confirms the newly activated grant version before the next periodic read', async () => {
    const onGrantChange = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => new Response(JSON.stringify(
        options?.method === 'POST' ? { canPublish: true, grantVersion: 1 } : { canPublish: false, grantVersion: 0 },
    ), { status: 200 })));
    render(<LocaleProvider initialLocale="en"><StaffPublicationAccess sessionId="event-1" canPublish={false} onGrantChange={onGrantChange} /></LocaleProvider>);
    await waitFor(() => expect(onGrantChange).toHaveBeenCalledWith(false, 0));
    fireEvent.click(screen.getByRole('button', { name: 'Join the stage' }));
    await waitFor(() => expect(onGrantChange).toHaveBeenLastCalledWith(true, 1));
    expect(fetch).toHaveBeenCalledTimes(2);
});
