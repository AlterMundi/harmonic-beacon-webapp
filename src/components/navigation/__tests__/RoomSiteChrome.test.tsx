// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { RoomSiteChrome } from '../RoomSiteChrome';

const route = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
afterEach(cleanup);

describe('room site chrome', () => {
    it.each(['/session/event-1', '/session/event-1/', '/ops/events/event-1', '/ops/session/event-1'])
        ('does not mount unrelated navigation on %s', pathname => {
            route.pathname = pathname;
            render(<RoomSiteChrome><nav><a href="/ops/health">Health</a></nav></RoomSiteChrome>);
            expect(screen.queryByRole('navigation')).toBeNull();
            expect(screen.queryByRole('link')).toBeNull();
        });
    it.each(['/', '/profile', '/ops/events', '/ops/events/manage', '/ops/health'])
        ('retains ordinary navigation on %s', pathname => {
            route.pathname = pathname;
            render(<RoomSiteChrome><nav><a href="/profile">Profile</a></nav></RoomSiteChrome>);
            expect(screen.getByRole('link', { name: 'Profile' })).toBeVisible();
        });
    it('changes only chrome while the sibling room and its draft retain their state', () => {
        let mounts = 0;
        function Room() {
            const [draft, setDraft] = useState(() => { mounts += 1; return ''; });
            return <input aria-label="Chat draft" value={draft} onChange={event => setDraft(event.target.value)} />;
        }
        function App() {
            return <><RoomSiteChrome><nav>Site navigation</nav></RoomSiteChrome><Room /></>;
        }
        route.pathname = '/';
        const { rerender } = render(<App />);
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My retained draft' } });
        route.pathname = '/session/event-1'; rerender(<App />);
        expect(screen.queryByRole('navigation')).toBeNull();
        expect(screen.getByRole('textbox')).toHaveValue('My retained draft');
        route.pathname = '/profile'; rerender(<App />);
        expect(screen.getByRole('navigation')).toBeVisible();
        expect(screen.getByRole('textbox')).toHaveValue('My retained draft');
        expect(mounts).toBe(1);
    });
});
