import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import ConsumerWithdrawalForm from '@/components/early-birds/ConsumerWithdrawalForm';
import { listenerWithdrawalPublicConfiguration } from '@/lib/listener/consumer-withdrawal';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'BOTÓN DE ARREPENTIMIENTO · Harmonic Beacon',
    robots: { index: true, follow: true },
};

export default function ListenerWithdrawalPage() {
    if (!listenerWithdrawalPublicConfiguration()) notFound();
    return <ConsumerWithdrawalForm />;
}
