'use client';

import { useState } from 'react';
import Link from 'next/link';

import { useLocale } from '@/context/LocaleContext';
import {
    LISTENER_WITHDRAWAL_API_PATH,
    LISTENER_WITHDRAWAL_RESPONSE_HOURS,
} from '@/lib/listener/consumer-withdrawal-contract';

const copy = {
    es: {
        back: 'Volver a Listener',
        eyebrow: 'DERECHO DEL CONSUMIDOR',
        title: 'BOTÓN DE ARREPENTIMIENTO',
        intro: 'Puedes solicitar la revocación de una compra sin iniciar sesión ni crear una cuenta. Recibirás un código de identificación de inmediato.',
        scope: 'Esta solicitud abre un caso para revisión. No cancela ni reembolsa automáticamente: el equipo verifica la operación con el proveedor y la procesa según tus derechos aplicables.',
        email: 'Correo usado para la compra',
        provider: 'Medio de pago',
        paypal: 'PayPal',
        mercadoPago: 'Mercado Pago',
        other: 'Otro o no lo recuerdo',
        purchaseDate: 'Fecha aproximada de compra (opcional)',
        submit: 'Enviar solicitud',
        submitting: 'Enviando…',
        failed: 'No pudimos recibir la solicitud ahora. Conserva los datos e intenta nuevamente.',
        rateLimited: 'Recibimos demasiadas solicitudes desde esta conexión. Intenta nuevamente más tarde.',
        received: 'Solicitud recibida',
        receipt: 'Tu código de identificación es',
        receiptHelp: `Guárdalo. El equipo debe revisar la solicitud dentro de ${LISTENER_WITHDRAWAL_RESPONSE_HOURS} horas y puede contactarte en el correo indicado.`,
    },
    en: {
        back: 'Back to Listener',
        eyebrow: 'CONSUMER RIGHT',
        title: 'BOTÓN DE ARREPENTIMIENTO',
        intro: 'You may request cancellation of a purchase without signing in or creating an account. You will receive an identification code immediately.',
        scope: 'This request opens a case for review. It does not cancel or refund automatically: the team verifies the transaction with the provider and processes it under your applicable rights.',
        email: 'Email used for the purchase',
        provider: 'Payment method',
        paypal: 'PayPal',
        mercadoPago: 'Mercado Pago',
        other: 'Other or I do not remember',
        purchaseDate: 'Approximate purchase date (optional)',
        submit: 'Send request',
        submitting: 'Sending…',
        failed: 'We could not receive the request right now. Keep the information and try again.',
        rateLimited: 'Too many requests came from this connection. Please try again later.',
        received: 'Request received',
        receipt: 'Your identification code is',
        receiptHelp: `Keep this code. The team must review the request within ${LISTENER_WITHDRAWAL_RESPONSE_HOURS} hours and may contact you at the email supplied.`,
    },
} as const;

type Receipt = { receiptCode: string; receivedAt: string };

export default function ConsumerWithdrawalForm() {
    const { locale } = useLocale();
    const text = copy[locale];
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [receipt, setReceipt] = useState<Receipt | null>(null);
    const [idempotencyKey] = useState(() => globalThis.crypto.randomUUID());

    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        const form = new FormData(event.currentTarget);
        try {
            const response = await fetch(LISTENER_WITHDRAWAL_API_PATH, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Listener-Withdrawal-Intent': '1',
                },
                body: JSON.stringify({
                    email: form.get('email'),
                    idempotencyKey,
                    locale,
                    provider: form.get('provider'),
                    purchaseDate: form.get('purchaseDate'),
                }),
            });
            if (!response.ok) {
                setError(response.status === 429 ? text.rateLimited : text.failed);
                return;
            }
            const body = await response.json() as Partial<Receipt>;
            if (typeof body.receiptCode !== 'string' || typeof body.receivedAt !== 'string') {
                setError(text.failed);
                return;
            }
            setReceipt({ receiptCode: body.receiptCode, receivedAt: body.receivedAt });
        } catch {
            setError(text.failed);
        } finally {
            setBusy(false);
        }
    }

    return (
        <main className="listener-shell listener-legal-shell">
            <article className="listener-legal listener-withdrawal">
                <Link href="/">← {text.back}</Link>
                <p>{text.eyebrow}</p>
                <h1>{text.title}</h1>
                {receipt ? (
                    <section className="listener-withdrawal__receipt" role="status" aria-live="polite">
                        <h2>{text.received}</h2>
                        <p>{text.receipt}</p>
                        <code>{receipt.receiptCode}</code>
                        <p>{text.receiptHelp}</p>
                    </section>
                ) : (
                    <>
                        <p className="listener-withdrawal__intro">{text.intro}</p>
                        <p className="listener-withdrawal__scope">{text.scope}</p>
                        <form onSubmit={submit} className="listener-withdrawal__form">
                            <label>
                                <span>{text.email}</span>
                                <input name="email" type="email" autoComplete="email" required maxLength={254} />
                            </label>
                            <label>
                                <span>{text.provider}</span>
                                <select name="provider" defaultValue="PAYPAL" required>
                                    <option value="PAYPAL">{text.paypal}</option>
                                    <option value="MERCADO_PAGO">{text.mercadoPago}</option>
                                    <option value="OTHER">{text.other}</option>
                                </select>
                            </label>
                            <label>
                                <span>{text.purchaseDate}</span>
                                <input name="purchaseDate" type="date" />
                            </label>
                            {error && <p role="alert" className="listener-withdrawal__error">{error}</p>}
                            <button type="submit" disabled={busy} className="listener-button listener-button--primary">
                                {busy ? text.submitting : text.submit}
                            </button>
                        </form>
                    </>
                )}
            </article>
        </main>
    );
}
