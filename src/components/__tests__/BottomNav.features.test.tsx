// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// Flags OFF: this file exercises the first-iteration (WS0) hidden state.
vi.mock('@/lib/features', () => ({
    features: { showLive: false, showMeditate: false, showPractice: false, showUpload: false },
}));

vi.mock('next/navigation', () => ({
    usePathname: vi.fn().mockReturnValue('/sessions'),
}));

vi.mock('next-auth/react', () => ({
    useSession: vi.fn().mockReturnValue({ data: { user: { role: 'USER' } } }),
}));

vi.mock('next/link', () => ({
    default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
        <a href={href} className={className}>{children}</a>
    ),
}));

import BottomNav from '../BottomNav';
import { useSession } from 'next-auth/react';

afterEach(cleanup);

function mockRole(role: string) {
    vi.mocked(useSession).mockReturnValue({
        data: { user: { role } } as never,
        status: 'authenticated',
        update: vi.fn(),
    });
}

describe('BottomNav with public surfaces hidden (WS0)', () => {
    beforeEach(() => mockRole('USER'));

    it('hides Live and Meditate from a listener — only Sessions and Profile remain', () => {
        render(<BottomNav />);
        expect(screen.queryByText('Live')).not.toBeInTheDocument();
        expect(screen.queryByText('Meditate')).not.toBeInTheDocument();
        expect(screen.getByText('Sessions')).toBeInTheDocument();
        expect(screen.getByText('Profile')).toBeInTheDocument();
        expect(screen.getAllByRole('link')).toHaveLength(2);
    });

    it('still shows Live and Meditate to a PROVIDER so they can preview', () => {
        mockRole('PROVIDER');
        render(<BottomNav />);
        const names = screen.getAllByRole('link').map((l) => l.textContent);
        expect(names).toEqual(['Live', 'Meditate', 'Studio', 'Sessions', 'Profile']);
    });
});
