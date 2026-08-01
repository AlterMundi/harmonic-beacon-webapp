// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import EventField from '../EventField';
import OperationalPanel from '../OperationalPanel';
import StatusPill from '../StatusPill';

afterEach(cleanup);

describe('event UI primitives', () => {
    it('associates a rich label and validation error with its field', () => {
        render(
            <EventField
                label={<span>Ticket <strong>code</strong></span>}
                error="Check the code"
                placeholder="XXXX"
            />,
        );

        const field = screen.getByRole('textbox', { name: 'Ticket code' });
        const alert = screen.getByRole('alert');
        expect(field).toHaveAttribute('aria-invalid', 'true');
        expect(field).toHaveAttribute('aria-describedby', alert.id);
    });

    it('preserves caller help text while appending the error description', () => {
        render(
            <>
                <p id="field-help">Private to this device</p>
                <EventField id="display-name" label="Name" aria-describedby="field-help" error="Required" />
            </>,
        );

        expect(screen.getByRole('textbox', { name: 'Name' }).getAttribute('aria-describedby'))
            .toBe('field-help display-name-error');
    });

    it('gives titled operational panels a real section heading relationship', () => {
        render(<OperationalPanel title="Room health">Nominal</OperationalPanel>);
        const section = screen.getByRole('region', { name: 'Room health' });
        expect(section).toHaveTextContent('Nominal');
        expect(section.className).toContain('operational-panel');
    });

    it('uses request and brand semantics rather than danger and success dots', () => {
        const { rerender } = render(<StatusPill variant="request">Hand raised</StatusPill>);
        expect(screen.getByText('Hand raised').querySelector('.status-pill__dot--request'))
            .toBeInTheDocument();

        rerender(<StatusPill variant="brand">Beacon</StatusPill>);
        expect(screen.getByText('Beacon').querySelector('.status-pill__dot--brand'))
            .toBeInTheDocument();
    });
});
