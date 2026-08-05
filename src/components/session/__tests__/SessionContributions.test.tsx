// @vitest-environment jsdom
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/context/LocaleContext';

import SessionContributions from '../SessionContributions';
import type { PublicContribution } from '../useContributionsFeed';

const SESSION = 'session-1';

function render(ui: ReactNode, locale: 'es' | 'en' = 'en') {
    return rtlRender(ui, {
        wrapper: ({ children }) => <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>,
    });
}

function contribution(overrides: Partial<PublicContribution> = {}): PublicContribution {
    return {
        id: 'contrib-1',
        body: 'How do we breathe together?',
        displayName: 'Ana',
        visibility: 'NAMED',
        createdAt: '2026-08-08T20:00:00.000Z',
        ...overrides,
    };
}

function page(
    contributions: PublicContribution[],
    envelope: { hasMore?: boolean; nextPageCursor?: string | null; resumeCursor?: string | null } = {},
) {
    return {
        contributions,
        hasMore: envelope.hasMore ?? false,
        nextPageCursor: envelope.nextPageCursor ?? null,
        resumeCursor: envelope.resumeCursor ?? null,
    };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name: string) => headers[name] ?? null },
        json: async () => body,
        clone() { return this; },
    } as unknown as Response;
}

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response> | Response;

function installFetch(handler: FetchHandler) {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        calls.push({
            url,
            method: init?.method ?? 'GET',
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return handler(url, init);
    });
    vi.stubGlobal('fetch', fetchMock);
    return { fetchMock, calls };
}

type RecordedCall = { url: string; method: string; body?: unknown };
const getCalls = (calls: RecordedCall[]) => calls.filter((call) => call.method === 'GET');
const postCalls = (calls: RecordedCall[]) => calls.filter((call) => call.method === 'POST');

async function flush() {
    await act(async () => { /* let microtasks settle */ });
}

beforeEach(() => {
    window.sessionStorage.clear();
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('initial load and pagination', () => {
    it('renders named and anonymous authors from the public DTO', async () => {
        installFetch(async () => jsonResponse(200, page([
            contribution({ id: 'c1', displayName: 'Ana', visibility: 'NAMED' }),
            contribution({ id: 'c2', displayName: null, visibility: 'ANONYMOUS', body: 'I feel calm' }),
        ], { resumeCursor: 'cur-2' })));
        render(<SessionContributions sessionId={SESSION} />);
        expect(await screen.findByText('Ana')).toBeInTheDocument();
        expect(screen.getByText('Anonymous')).toBeInTheDocument();
        expect(screen.getByText('I feel calm')).toBeInTheDocument();
    });

    it('drains the backlog with nextPageCursor until hasMore is false', async () => {
        const { calls } = installFetch(async (url) => {
            if (url.includes('cursor=cur-1')) {
                return jsonResponse(200, page([contribution({ id: 'c2', body: 'second page item' })], { resumeCursor: 'cur-2' }));
            }
            return jsonResponse(200, page([contribution({ id: 'c1' })], {
                hasMore: true,
                nextPageCursor: 'cur-1',
                resumeCursor: 'cur-1',
            }));
        });
        render(<SessionContributions sessionId={SESSION} />);
        expect(await screen.findByText('second page item')).toBeInTheDocument();
        const urls = getCalls(calls).map((call) => call.url);
        expect(urls).toHaveLength(2);
        expect(urls[1]).toContain('cursor=cur-1');
        expect(urls[0]).toContain(`scheduled-sessions/${SESSION}/contributions`);
    });

    it('shows the empty state when the feed has nothing', async () => {
        installFetch(async () => jsonResponse(200, page([])));
        render(<SessionContributions sessionId={SESSION} />);
        expect(await screen.findByText('No questions or emotions yet. Be the first voice.')).toBeInTheDocument();
    });

    it('shows the read-only ended state on 403 and hides the composer', async () => {
        installFetch(async () => jsonResponse(403, { code: 'forbidden' }));
        render(<SessionContributions sessionId={SESSION} />);
        expect(await screen.findByText('The session has ended. The conversation is read-only.')).toBeInTheDocument();
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('shows the error state when the initial load fails', async () => {
        installFetch(async () => jsonResponse(500, {}));
        render(<SessionContributions sessionId={SESSION} />);
        expect(await screen.findByText('Could not publish. Your text is still here, try again.')).toBeInTheDocument();
    });
});

describe('incremental polling', () => {
    it('polls with the tail resumeCursor and appends only new items, deduped', async () => {
        vi.useFakeTimers();
        let pollCount = 0;
        const { calls } = installFetch(async (url) => {
            if (url.includes('cursor=')) {
                pollCount += 1;
                if (pollCount === 1) {
                    // First poll: one new item + a duplicate of c1 (defensive dedupe).
                    return jsonResponse(200, page([
                        contribution({ id: 'c1', body: 'duplicated' }),
                        contribution({ id: 'c2', body: 'a brand new one' }),
                    ], { resumeCursor: 'cur-2' }));
                }
                return jsonResponse(200, page([], {})); // empty page: both cursors null
            }
            return jsonResponse(200, page([contribution({ id: 'c1' })], { resumeCursor: 'cur-1' }));
        });
        render(<SessionContributions sessionId={SESSION} />);
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(screen.getByText('How do we breathe together?')).toBeInTheDocument();

        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        expect(screen.getByText('a brand new one')).toBeInTheDocument();
        expect(screen.getAllByText('How do we breathe together?')).toHaveLength(1);

        // Empty page: our cursor stays valid; the next poll reuses cur-2.
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        const pollUrls = getCalls(calls).map((call) => call.url).filter((url) => url.includes('cursor='));
        expect(pollUrls[0]).toContain('cursor=cur-1');
        expect(pollUrls[pollUrls.length - 1]).toContain('cursor=cur-2');
    });

    it('never fires a second poll while one is in flight', async () => {
        vi.useFakeTimers();
        let resolvePoll: ((response: Response) => void) | null = null;
        const { fetchMock } = installFetch((url) => {
            if (url.includes('cursor=')) {
                return new Promise<Response>((resolve) => { resolvePoll = resolve; });
            }
            return jsonResponse(200, page([contribution({ id: 'c1' })], { resumeCursor: 'cur-1' }));
        });
        render(<SessionContributions sessionId={SESSION} />);
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(screen.getByText('How do we breathe together?')).toBeInTheDocument();

        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        const getCount = fetchMock.mock.calls.filter(([url]) => String(url).includes('cursor=')).length;
        expect(getCount).toBe(1);
        await act(async () => {
            resolvePoll?.(jsonResponse(200, page([], {})));
        });
    });
});

describe('composer', () => {
    async function renderWithFeed() {
        const utils = installFetch(async (url, init) => {
            if (init?.method === 'POST') {
                const payload = JSON.parse(String(init.body)) as { idempotencyKey: string; visibility: string };
                return jsonResponse(201, contribution({
                    id: `created-${payload.idempotencyKey}`,
                    visibility: payload.visibility as 'NAMED' | 'ANONYMOUS',
                    displayName: payload.visibility === 'ANONYMOUS' ? null : 'Ana',
                }));
            }
            return jsonResponse(200, page([], {}));
        });
        render(<SessionContributions sessionId={SESSION} />);
        await screen.findByText('No questions or emotions yet. Be the first voice.');
        return utils;
    }

    it('the two explicit actions send NAMED and ANONYMOUS respectively', async () => {
        const { calls } = await renderWithFeed();
        const user = userEvent.setup();
        const textarea = screen.getByRole('textbox');

        await user.type(textarea, 'First message');
        await user.click(screen.getByRole('button', { name: 'Share' }));
        expect(postCalls(calls)[0].body).toMatchObject({ body: 'First message', visibility: 'NAMED' });

        await user.type(textarea, 'Second message');
        await user.click(screen.getByRole('button', { name: 'Share anonymously' }));
        expect(postCalls(calls)[1].body).toMatchObject({ body: 'Second message', visibility: 'ANONYMOUS' });
    });

    it('success clears the draft, announces the publication and rotates the key', async () => {
        const { calls } = await renderWithFeed();
        const user = userEvent.setup();
        const textarea = screen.getByRole('textbox');

        await user.type(textarea, 'One key per draft');
        await user.click(screen.getByRole('button', { name: 'Share' }));
        expect(await screen.findByText('Published')).toBeInTheDocument();
        expect(textarea).toHaveValue('');
        expect(window.sessionStorage.getItem(`hb-contrib-draft:${SESSION}`)).toBeNull();

        await user.type(textarea, 'A different draft');
        await user.click(screen.getByRole('button', { name: 'Share' }));
        const [first, second] = postCalls(calls);
        expect((first.body as { idempotencyKey: string }).idempotencyKey)
            .not.toBe((second.body as { idempotencyKey: string }).idempotencyKey);
    });

    it('a 200 replay resolves silently like a success', async () => {
        installFetch(async (url, init) => {
            if (init?.method === 'POST') return jsonResponse(200, contribution({ id: 'existing' }));
            return jsonResponse(200, page([], {}));
        });
        render(<SessionContributions sessionId={SESSION} />);
        await screen.findByText('No questions or emotions yet. Be the first voice.');
        const user = userEvent.setup();

        await user.type(screen.getByRole('textbox'), 'retry of a sent message');
        await user.click(screen.getByRole('button', { name: 'Share' }));
        await flush();
        expect(screen.getByRole('textbox')).toHaveValue('');
        expect(screen.queryByText('Published')).not.toBeInTheDocument();
        expect(screen.queryByText(/Could not publish/)).not.toBeInTheDocument();
    });

    it('a network error preserves the draft and the retry reuses the same key', async () => {
        let failFirst = true;
        const { calls } = installFetch(async (url, init) => {
            if (init?.method === 'POST') {
                if (failFirst) {
                    failFirst = false;
                    throw new Error('network down');
                }
                return jsonResponse(201, contribution({ id: 'recovered' }));
            }
            return jsonResponse(200, page([], {}));
        });
        render(<SessionContributions sessionId={SESSION} />);
        await screen.findByText('No questions or emotions yet. Be the first voice.');
        const user = userEvent.setup();

        await user.type(screen.getByRole('textbox'), 'keep me safe');
        await user.click(screen.getByRole('button', { name: 'Share' }));
        expect(await screen.findByText('Could not publish. Your text is still here, try again.')).toBeInTheDocument();
        expect(screen.getByRole('textbox')).toHaveValue('keep me safe');

        await user.click(screen.getByRole('button', { name: 'Share' }));
        await flush();
        const posts = postCalls(calls);
        expect(posts).toHaveLength(2);
        expect((posts[0].body as { idempotencyKey: string }).idempotencyKey)
            .toBe((posts[1].body as { idempotencyKey: string }).idempotencyKey);
    });

    it('429 shows a live countdown from retryAfterSeconds and blocks submit until it ends', async () => {
        vi.useFakeTimers();
        let limited = true;
        const { calls } = installFetch(async (url, init) => {
            if (init?.method === 'POST') {
                if (limited) {
                    limited = false;
                    return jsonResponse(429, { code: 'rate_limited', retryAfterSeconds: 3 }, { 'Retry-After': '3' });
                }
                return jsonResponse(201, contribution({ id: 'after-limit' }));
            }
            return jsonResponse(200, page([], {}));
        });
        render(<SessionContributions sessionId={SESSION} />);
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });

        const textarea = screen.getByRole('textbox');
        fireEvent.change(textarea, { target: { value: 'too fast' } });
        fireEvent.click(screen.getByRole('button', { name: 'Share' }));
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(screen.getByText('Wait 3 s before sharing again')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Share' })).toBeDisabled();
        expect(textarea).toHaveValue('too fast');

        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
        expect(screen.getByText('Wait 1 s before sharing again')).toBeInTheDocument();
        await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
        expect(screen.getByRole('button', { name: 'Share' })).toBeEnabled();

        fireEvent.click(screen.getByRole('button', { name: 'Share' }));
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(postCalls(calls)).toHaveLength(2);
    });

    it('a 409 conflict rotates the key and offers an explicit retry', async () => {
        let conflicted = true;
        const { calls } = installFetch(async (url, init) => {
            if (init?.method === 'POST') {
                if (conflicted) {
                    conflicted = false;
                    return jsonResponse(409, { code: 'idempotency_key_conflict' });
                }
                return jsonResponse(201, contribution({ id: 'resent' }));
            }
            return jsonResponse(200, page([], {}));
        });
        render(<SessionContributions sessionId={SESSION} />);
        await screen.findByText('No questions or emotions yet. Be the first voice.');
        const user = userEvent.setup();

        await user.type(screen.getByRole('textbox'), 'conflicting draft');
        await user.click(screen.getByRole('button', { name: 'Share' }));
        expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
        expect(screen.getByRole('textbox')).toHaveValue('conflicting draft');

        await user.click(screen.getByRole('button', { name: 'Retry' }));
        await flush();
        const posts = postCalls(calls);
        expect(posts).toHaveLength(2);
        expect((posts[0].body as { idempotencyKey: string }).idempotencyKey)
            .not.toBe((posts[1].body as { idempotencyKey: string }).idempotencyKey);
    });

    it('blocks typing beyond 1000 code points', async () => {
        await renderWithFeed();
        const user = userEvent.setup();
        const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
        const long = '🌊'.repeat(1001); // surrogate pairs: UTF-16 maxLength would misjudge these
        await user.click(textarea);
        await user.paste(long);
        expect([...textarea.value].length).toBe(1000);
    });

    it('persists the draft and key in sessionStorage and restores them on remount', async () => {
        const { calls } = await renderWithFeed();
        const user = userEvent.setup();
        await user.type(screen.getByRole('textbox'), 'un Sent draft');
        const stored = JSON.parse(
            window.sessionStorage.getItem(`hb-contrib-draft:${SESSION}`) ?? '{}',
        ) as { body: string; key: string };
        expect(stored.body).toBe('un Sent draft');
        expect(stored.key).toBeTruthy();
        cleanup();

        render(<SessionContributions sessionId={SESSION} />);
        await screen.findByText('No questions or emotions yet. Be the first voice.');
        expect(screen.getByRole('textbox')).toHaveValue('un Sent draft');
        await user.click(screen.getByRole('button', { name: 'Share' }));
        await flush();
        expect((postCalls(calls)[0].body as { idempotencyKey: string }).idempotencyKey).toBe(stored.key);
    });

    it('a draft from session A never appears in session B', async () => {
        window.sessionStorage.setItem(
            'hb-contrib-draft:session-a',
            JSON.stringify({ body: 'draft of A', key: 'key-a' }),
        );
        installFetch(async () => jsonResponse(200, page([], {})));
        render(<SessionContributions sessionId="session-b" />);
        await screen.findByText('No questions or emotions yet. Be the first voice.');
        expect(screen.getByRole('textbox')).toHaveValue('');
    });

    it('shows the anonymity explanation before sending', () => {
        installFetch(async () => jsonResponse(200, page([], {})));
        render(<SessionContributions sessionId={SESSION} />);
        expect(screen.getByText(/the room will not see your name/)).toBeInTheDocument();
        expect(screen.getByText(/facilitation team can still see/)).toBeInTheDocument();
    });
});

describe('offline and i18n', () => {
    it('announces offline and disables the actions until the connection returns', async () => {
        installFetch(async () => jsonResponse(200, page([], {})));
        render(<SessionContributions sessionId={SESSION} />);
        await screen.findByText('No questions or emotions yet. Be the first voice.');
        const user = userEvent.setup();
        await user.type(screen.getByRole('textbox'), 'hello');

        act(() => { window.dispatchEvent(new Event('offline')); });
        expect(screen.getByText(/You are offline/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Share' })).toBeDisabled();

        act(() => { window.dispatchEvent(new Event('online')); });
        expect(screen.queryByText(/You are offline/)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Share' })).toBeEnabled();
    });

    it('renders the Spanish copy', async () => {
        installFetch(async () => jsonResponse(200, page([
            contribution({ id: 'c1', visibility: 'ANONYMOUS', displayName: null }),
        ])));
        render(<SessionContributions sessionId={SESSION} />, 'es');
        expect(await screen.findByText('Anónimo')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Compartir' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Compartir anónimo' })).toBeInTheDocument();
        expect(screen.getByText(/la sala no verá tu nombre/)).toBeInTheDocument();
    });
});
