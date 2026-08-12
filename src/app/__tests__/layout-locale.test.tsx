import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    headers: vi.fn(),
    requestLocale: vi.fn(),
}));

vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('@/lib/i18n-server', () => ({ requestLocale: mocks.requestLocale }));
vi.mock('next/font/local', () => ({
    default: () => ({ variable: 'local-font' }),
}));
vi.mock('@/context/LocaleContext', () => ({
    LocaleProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('sonner', () => ({ Toaster: () => null }));

import RootLayout from '../layout';

function requestHeaders(host: string, acceptLanguage: string): Headers {
    return new Headers({ host, 'accept-language': acceptLanguage });
}

describe('root document locale boundary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('matches the canonical Listener SSR document to browser-language content', async () => {
        mocks.headers.mockResolvedValue(requestHeaders(
            'listen.harmonicbeacon.com',
            'en-US,en;q=0.9,es;q=0.7',
        ));
        mocks.requestLocale.mockResolvedValue('es');

        const result = await RootLayout({ children: <main /> });

        expect(result.props.lang).toBe('en');
        expect(result.props['data-lang']).toBe('en');
        expect(mocks.requestLocale).not.toHaveBeenCalled();
    });

    it('preserves the existing event locale decision on every non-Listener host', async () => {
        mocks.headers.mockResolvedValue(requestHeaders(
            'live.harmonicbeacon.com',
            'en-US,en;q=0.9',
        ));
        mocks.requestLocale.mockResolvedValue('es');

        const result = await RootLayout({ children: <main /> });

        expect(result.props.lang).toBe('es');
        expect(result.props['data-lang']).toBe('es');
        expect(mocks.requestLocale).toHaveBeenCalledOnce();
    });
});
