'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useLocale } from '@/context/LocaleContext';
import {
    LISTENER_SERVICE_CANCELLATION_PATH,
    LISTENER_WITHDRAWAL_PATH,
} from '@/lib/listener/consumer-withdrawal-contract';

export default function ConsumerWithdrawalLink({
    inline = false,
    kind = 'WITHDRAWAL',
}: {
    inline?: boolean;
    kind?: 'WITHDRAWAL' | 'SERVICE_CANCELLATION';
}) {
    const { locale } = useLocale();
    const pathname = usePathname();
    const serviceCancellation = kind === 'SERVICE_CANCELLATION';
    const path = serviceCancellation ? LISTENER_SERVICE_CANCELLATION_PATH : LISTENER_WITHDRAWAL_PATH;
    const title = serviceCancellation ? 'BOTÓN DE BAJA DE SERVICIO' : 'BOTÓN DE ARREPENTIMIENTO';
    if (!inline && pathname === path) return null;
    return (
        <Link
            href={path}
            className={inline ? 'listener-withdrawal-link--inline' : 'listener-withdrawal-link'}
        >
            <strong>{title}</strong>
            {!inline && <span>{serviceCancellation
                ? (locale === 'es' ? 'Dar de baja el servicio' : 'Cancel the service')
                : (locale === 'es' ? 'Revocar una compra' : 'Withdraw from a purchase')}</span>}
        </Link>
    );
}
