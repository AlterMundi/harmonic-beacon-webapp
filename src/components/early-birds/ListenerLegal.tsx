'use client';

import { useLocale } from '@/context/LocaleContext';
import { earlyBirdLegalCopy } from '@/lib/early-birds/copy';
import Link from 'next/link';
import ConsumerWithdrawalLink from './ConsumerWithdrawalLink';

export default function ListenerLegal() {
    const { locale } = useLocale();
    const copy = earlyBirdLegalCopy[locale];

    return (
        <main className="listener-shell listener-legal-shell">
            <article className="listener-legal">
                <Link href="/">← {copy.back}</Link>
                <p>{copy.eyebrow}</p>
                <h1>{copy.title}</h1>
                <p>{copy.updated}</p>
                {copy.sections.map((section) => (
                    <section key={section.title}>
                        <h2>{section.title}</h2>
                        {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                    </section>
                ))}
                <section>
                    <h2>{locale === 'es' ? 'Derecho de revocación' : 'Cancellation right'}</h2>
                    <p>
                        {locale === 'es'
                            ? 'Puedes iniciar una solicitud pública sin ingresar a tu cuenta.'
                            : 'You can open a public request without signing in to your account.'}{' '}
                        <ConsumerWithdrawalLink inline />
                    </p>
                </section>
            </article>
        </main>
    );
}
