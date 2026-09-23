// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LocaleProvider } from '@/context/LocaleContext';
import { RoomExitProvider, useRoomExit } from '@/components/navigation/RoomExitGuard';
import { StaffModeAccess } from '../StaffModeAccess';

afterEach(cleanup);
function ActiveRoom() { useRoomExit(true); return null; }
describe('visible staff access', () => {
    it('does not expose a mode switch to ordinary participants', () => {
        render(<LocaleProvider initialLocale="es"><StaffModeAccess availableRole={null} activeStaffRole={null} /></LocaleProvider>);
        expect(screen.queryByRole('complementary')).toBeNull();
    });
    it('recognizes admin while preserving participant mode and existing staff OAuth', () => {
        render(<LocaleProvider initialLocale="es"><StaffModeAccess availableRole="ADMIN" activeStaffRole={null} /></LocaleProvider>);
        expect(screen.getByText(/Estás en modo participante/)).toBeVisible();
        expect(screen.getByRole('link', { name: 'Administrar eventos' })).toHaveAttribute('href', '/api/account/login?flow=staff&next=%2Fops%2Fevents%2Fmanage');
        expect(screen.getByRole('link', { name: 'Entrar como participante' })).toHaveAttribute('href', '/');
    });
    it('provides an explicit return to attendee flow from staff mode', () => {
        render(<LocaleProvider initialLocale="en"><StaffModeAccess availableRole="ADMIN" activeStaffRole="ADMIN" /></LocaleProvider>);
        expect(screen.getByText(/You are in staff mode/)).toBeVisible();
        expect(screen.getByRole('link', { name: 'Manage events' })).toHaveAttribute('href', '/ops/events/manage');
        expect(screen.getByRole('link', { name: 'Enter as participant' })).toHaveAttribute('href', '/api/account/login?flow=attendee&next=%2F');
    });
    it('routes operators to their existing permissions, not event management', () => {
        render(<LocaleProvider initialLocale="en"><StaffModeAccess availableRole="OPERATOR" activeStaffRole={null} /></LocaleProvider>);
        expect(screen.getByRole('link', { name: 'Open operations' })).toHaveAttribute('href', '/api/account/login?flow=staff&next=%2Fops%2Fevents');
    });
    it('asks before leaving an active room and permits cancellation', () => {
        render(<LocaleProvider initialLocale="en"><RoomExitProvider><ActiveRoom /><StaffModeAccess availableRole="ADMIN" activeStaffRole={null} /></RoomExitProvider></LocaleProvider>);
        fireEvent.click(screen.getByRole('link', { name: 'Manage events' }));
        expect(screen.getByRole('alertdialog')).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Stay in the room' }));
        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect(screen.getByRole('link', { name: 'Manage events' })).toHaveFocus();
    });
});
