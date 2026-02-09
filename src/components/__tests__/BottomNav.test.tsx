// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
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

afterEach(cleanup);

describe('BottomNav', () => {
    it('renders 4 navigation tabs', () => {
        render(<BottomNav />);
        expect(screen.getByText('Live')).toBeInTheDocument();
        expect(screen.getByText('Meditate')).toBeInTheDocument();
        expect(screen.getByText('Sessions')).toBeInTheDocument();
        expect(screen.getByText('Profile')).toBeInTheDocument();
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
});
