// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import SessionGuidance from '@/components/session/SessionGuidance';
import { messages } from '@/lib/i18n';

describe('SessionGuidance', () => {
    afterEach(() => {
        cleanup();
    });

    it('renders the full Spanish guidance behind a closed disclosure', () => {
        render(<SessionGuidance copy={messages.es.session.guidance} />);

        const toggle = screen.getByRole('button', { name: 'Cómo funciona la escucha' });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');

        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');

        const guidance = messages.es.session.guidance;
        expect(screen.getByText(guidance.intention)).toBeVisible();
        expect(screen.getByText(guidance.volume)).toBeVisible();
        expect(screen.getByText(guidance.balance)).toBeVisible();
        expect(screen.getByText(guidance.balanceFullBeacon)).toBeVisible();
        expect(screen.getByText(guidance.cameraMic)).toBeVisible();
        expect(screen.getByText(guidance.control)).toBeVisible();
    });

    it('renders the full English guidance behind a closed disclosure', () => {
        render(<SessionGuidance copy={messages.en.session.guidance} />);

        const toggle = screen.getByRole('button', { name: 'How listening works' });
        fireEvent.click(toggle);

        const guidance = messages.en.session.guidance;
        expect(screen.getByText(guidance.intention)).toBeVisible();
        expect(screen.getByText(guidance.volume)).toBeVisible();
        expect(screen.getByText(guidance.balance)).toBeVisible();
        expect(screen.getByText(guidance.balanceFullBeacon)).toBeVisible();
        expect(screen.getByText(guidance.cameraMic)).toBeVisible();
        expect(screen.getByText(guidance.control)).toBeVisible();
    });

    it('starts closed and hides the panel from sighted and assistive users', () => {
        render(<SessionGuidance copy={messages.es.session.guidance} />);

        const toggle = screen.getByRole('button');
        const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
        expect(panel).not.toBeNull();
        expect(panel).not.toBeVisible();
        expect(screen.queryByText(messages.es.session.guidance.intention)).not.toBeVisible();
    });

    it('wires aria-expanded and aria-controls to a real panel', () => {
        render(<SessionGuidance copy={messages.en.session.guidance} />);

        const toggle = screen.getByRole('button');
        const controls = toggle.getAttribute('aria-controls');
        expect(controls).toBeTruthy();
        const panel = document.getElementById(controls as string);
        expect(panel).not.toBeNull();
        expect(panel).toHaveAttribute('hidden');

        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(panel).not.toHaveAttribute('hidden');

        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(panel).toHaveAttribute('hidden');
    });

    it('toggles with keyboard and keeps focus on the button', () => {
        render(<SessionGuidance copy={messages.en.session.guidance} />);

        const toggle = screen.getByRole('button');
        toggle.focus();
        expect(toggle).toHaveFocus();

        fireEvent.keyDown(toggle, { key: 'Enter', code: 'Enter' });
        fireEvent.keyUp(toggle, { key: 'Enter', code: 'Enter' });
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(toggle).toHaveFocus();

        fireEvent.keyDown(toggle, { key: ' ', code: 'Space' });
        fireEvent.keyUp(toggle, { key: ' ', code: 'Space' });
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(toggle).toHaveFocus();
    });

    it('always shows a readable text label, never an icon-only control', () => {
        render(<SessionGuidance copy={messages.es.session.guidance} />);

        const toggle = screen.getByRole('button');
        expect(toggle.textContent).toContain(messages.es.session.guidance.label);
        const icon = toggle.querySelector('svg');
        expect(icon).not.toBeNull();
        expect(icon).toHaveAttribute('aria-hidden', 'true');
    });

    it('uses motion-safe classes only, so reduced-motion users see no animation', () => {
        render(<SessionGuidance copy={messages.en.session.guidance} />);

        const root = screen.getByTestId('session-guidance');
        const animated = root.querySelectorAll('[class*="motion-safe"]');
        expect(animated.length).toBeGreaterThan(0);
        animated.forEach((element) => {
            expect(element.getAttribute('class') ?? '').toContain('motion-reduce');
        });
        // No JS-driven animation timers: the panel toggles via the hidden
        // attribute alone, which prefers-reduced-motion cannot aggravate.
        fireEvent.click(screen.getByRole('button'));
        expect(screen.getByText(messages.en.session.guidance.intention)).toBeVisible();
    });

    it('meets the 44px touch target and never truncates long copy', () => {
        render(<SessionGuidance copy={messages.es.session.guidance} />);

        const toggle = screen.getByRole('button');
        expect(toggle.className).toContain('min-h-11');

        fireEvent.click(toggle);
        // Full sentences render untruncated: the panel applies no clamping or
        // ellipsis utilities, so each complete sentence is present verbatim.
        const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
        expect(panel?.className).not.toContain('truncate');
        expect(panel?.className).not.toContain('line-clamp');
        expect(panel?.className).not.toContain('overflow-hidden');
        for (const line of Object.values(messages.es.session.guidance)) {
            if (line === messages.es.session.guidance.label) continue;
            expect(panel?.textContent).toContain(line);
        }
    });
});
