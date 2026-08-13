import type { Metadata } from 'next';

import ConsumerWithdrawalForm from '@/components/early-birds/ConsumerWithdrawalForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'BOTÓN DE ARREPENTIMIENTO · Harmonic Beacon',
    robots: { index: true, follow: true },
};

export default function ListenerWithdrawalPage() {
    return <ConsumerWithdrawalForm />;
}
