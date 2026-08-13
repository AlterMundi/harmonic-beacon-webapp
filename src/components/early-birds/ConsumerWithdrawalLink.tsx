'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useLocale } from '@/context/LocaleContext';
import { LISTENER_WITHDRAWAL_PATH } from '@/lib/listener/consumer-withdrawal-contract';

export default function ConsumerWithdrawalLink({ inline = false }: { inline?: boolean }) {
    const { locale } = useLocale();
    const pathname = usePathname();
    if (!inline && pathname === LISTENER_WITHDRAWAL_PATH) return null;
    return (
        <Link
            href={LISTENER_WITHDRAWAL_PATH}
            className={inline ? 'listener-withdrawal-link--inline' : 'listener-withdrawal-link'}
        >
            <strong>BOTÓN DE ARREPENTIMIENTO</strong>
            {!inline && <span>{locale === 'es' ? 'Cancelar una compra' : 'Request cancellation'}</span>}
        </Link>
    );
}
