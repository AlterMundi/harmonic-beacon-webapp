import type { Metadata } from 'next';
import DeviceCheck from '@/components/session/DeviceCheck';

export const metadata: Metadata = { title: 'Prueba de dispositivos | Harmonic Beacon', robots: { index: false, follow: false } };

export default function DeviceCheckPage() {
    return <DeviceCheck />;
}
