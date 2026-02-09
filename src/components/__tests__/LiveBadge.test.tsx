// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import LiveBadge from '../LiveBadge';

afterEach(cleanup);

describe('LiveBadge', () => {
    it('renders "Live" text for state="live"', () => {
        render(<LiveBadge state="live" />);
        expect(screen.getByText('Live')).toBeInTheDocument();
    });

    it('applies live-badge class for state="live"', () => {
        render(<LiveBadge state="live" />);
        expect(screen.getByText('Live').className).toContain('live-badge');
    });

    it('renders "Playlist" text for state="playlist"', () => {
        render(<LiveBadge state="playlist" />);
        expect(screen.getByText('Playlist')).toBeInTheDocument();
    });

    it('renders "Offline" text for state="offline"', () => {
        render(<LiveBadge state="offline" />);
        expect(screen.getByText('Offline')).toBeInTheDocument();
    });

    it('supports backward compat: isLive=true maps to "live"', () => {
        render(<LiveBadge isLive={true} />);
        expect(screen.getByText('Live')).toBeInTheDocument();
    });

    it('supports backward compat: isLive=false maps to "offline"', () => {
        render(<LiveBadge isLive={false} />);
        expect(screen.getByText('Offline')).toBeInTheDocument();
    });

    it('applies custom className', () => {
        render(<LiveBadge state="live" className="my-class" />);
        expect(screen.getByText('Live').className).toContain('my-class');
    });
});
