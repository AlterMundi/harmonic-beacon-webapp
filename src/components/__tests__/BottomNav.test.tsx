// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// Mock next/navigation
vi.mock('next/navigation', () => ({
    usePathname: vi.fn().mockReturnValue('/live'),
}));

// Mock next-auth/react
vi.mock('next-auth/react', () => ({
    useSession: vi.fn().mockReturnValue({ data: { user: { role: 'USER' } } }),
}));

// Mock next/link to render a plain anchor
vi.mock('next/link', () => ({
    default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
        <a href={href} className={className}>{children}</a>
    ),
}));

import BottomNav from '../BottomNav';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';

afterEach(cleanup);

function mockRole(role: string) {
    vi.mocked(useSession).mockReturnValue({
        data: { user: { role } } as never,
        status: 'authenticated',
        update: vi.fn(),
    });
}

describe('BottomNav', () => {
    beforeEach(() => {
        mockRole('USER');
        vi.mocked(usePathname).mockReturnValue('/live');
    });

    describe('base tabs (LISTENER/USER)', () => {
        it('renders 4 navigation tabs for USER role', () => {
            render(<BottomNav />);
            expect(screen.getByText('Live')).toBeInTheDocument();
            expect(screen.getByText('Meditate')).toBeInTheDocument();
            expect(screen.getByText('Sessions')).toBeInTheDocument();
            expect(screen.getByText('Profile')).toBeInTheDocument();
            expect(screen.queryByText('Studio')).not.toBeInTheDocument();
            expect(screen.queryByText('Admin')).not.toBeInTheDocument();
        });

        it('renders correct hrefs', () => {
            render(<BottomNav />);
            const links = screen.getAllByRole('link');
            const hrefs = links.map(l => l.getAttribute('href'));
            expect(hrefs).toContain('/live');
            expect(hrefs).toContain('/meditation');
            expect(hrefs).toContain('/sessions');
            expect(hrefs).toContain('/profile');
        });

        it('renders exactly 4 links for USER', () => {
            render(<BottomNav />);
            expect(screen.getAllByRole('link')).toHaveLength(4);
        });
    });

    describe('active state', () => {
        it('highlights active tab based on pathname', () => {
            vi.mocked(usePathname).mockReturnValue('/meditation');
            render(<BottomNav />);
            const meditateLink = screen.getByText('Meditate').closest('a');
            expect(meditateLink?.className).toContain('active');
        });

        it('does not highlight non-active tabs', () => {
            vi.mocked(usePathname).mockReturnValue('/live');
            render(<BottomNav />);
            const profileLink = screen.getByText('Profile').closest('a');
            expect(profileLink?.className).not.toContain('active');
        });

        it('treats root / as /live for active state', () => {
            vi.mocked(usePathname).mockReturnValue('/');
            render(<BottomNav />);
            const liveLink = screen.getByText('Live').closest('a');
            expect(liveLink?.className).toContain('active');
        });

        it('highlights Studio tab on /provider/* paths', () => {
            mockRole('PROVIDER');
            vi.mocked(usePathname).mockReturnValue('/provider/dashboard');
            render(<BottomNav />);
            const studioLink = screen.getByText('Studio').closest('a');
            expect(studioLink?.className).toContain('active');
        });

        it('highlights Admin tab on /admin/* paths', () => {
            mockRole('ADMIN');
            vi.mocked(usePathname).mockReturnValue('/admin/users');
            render(<BottomNav />);
            const adminLink = screen.getByText('Admin').closest('a');
            expect(adminLink?.className).toContain('active');
        });
    });

    describe('PROVIDER role tabs', () => {
        beforeEach(() => mockRole('PROVIDER'));

        it('shows Studio tab for PROVIDER', () => {
            render(<BottomNav />);
            expect(screen.getByText('Studio')).toBeInTheDocument();
        });

        it('renders 5 links for PROVIDER', () => {
            render(<BottomNav />);
            expect(screen.getAllByRole('link')).toHaveLength(5);
        });

        it('does not show Admin tab for PROVIDER', () => {
            render(<BottomNav />);
            expect(screen.queryByText('Admin')).not.toBeInTheDocument();
        });

        it('places Studio between Meditate and Sessions', () => {
            render(<BottomNav />);
            const links = screen.getAllByRole('link');
            const names = links.map(l => l.textContent);
            expect(names).toEqual(['Live', 'Meditate', 'Studio', 'Sessions', 'Profile']);
        });

        it('Studio links to /provider/dashboard', () => {
            render(<BottomNav />);
            const studioLink = screen.getByText('Studio').closest('a');
            expect(studioLink?.getAttribute('href')).toBe('/provider/dashboard');
        });
    });

    describe('ADMIN role tabs', () => {
        beforeEach(() => mockRole('ADMIN'));

        it('shows both Studio and Admin tabs', () => {
            render(<BottomNav />);
            expect(screen.getByText('Studio')).toBeInTheDocument();
            expect(screen.getByText('Admin')).toBeInTheDocument();
        });

        it('renders 6 links for ADMIN', () => {
            render(<BottomNav />);
            expect(screen.getAllByRole('link')).toHaveLength(6);
        });

        it('places tabs in correct order: Live, Meditate, Studio, Sessions, Admin, Profile', () => {
            render(<BottomNav />);
            const links = screen.getAllByRole('link');
            const names = links.map(l => l.textContent);
            expect(names).toEqual(['Live', 'Meditate', 'Studio', 'Sessions', 'Admin', 'Profile']);
        });

        it('Admin links to /admin', () => {
            render(<BottomNav />);
            const adminLink = screen.getByText('Admin').closest('a');
            expect(adminLink?.getAttribute('href')).toBe('/admin');
        });
    });

    describe('LISTENER role', () => {
        beforeEach(() => mockRole('LISTENER'));

        it('shows only base 4 tabs for LISTENER', () => {
            render(<BottomNav />);
            expect(screen.getAllByRole('link')).toHaveLength(4);
            expect(screen.queryByText('Studio')).not.toBeInTheDocument();
            expect(screen.queryByText('Admin')).not.toBeInTheDocument();
        });
    });

    describe('no session', () => {
        it('shows only base 4 tabs when session is null', () => {
            vi.mocked(useSession).mockReturnValue({
                data: null,
                status: 'unauthenticated',
                update: vi.fn(),
            });
            render(<BottomNav />);
            expect(screen.getAllByRole('link')).toHaveLength(4);
            expect(screen.queryByText('Studio')).not.toBeInTheDocument();
            expect(screen.queryByText('Admin')).not.toBeInTheDocument();
        });
    });
});
