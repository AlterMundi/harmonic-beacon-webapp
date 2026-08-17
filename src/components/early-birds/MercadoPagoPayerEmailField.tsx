'use client';

import { useId } from 'react';

import { useLocale } from '@/context/LocaleContext';
import { earlyBirdCopy } from '@/lib/early-birds/copy';

export default function MercadoPagoPayerEmailField({
    value,
    disabled,
    invalid,
    onChange,
}: {
    value: string;
    disabled: boolean;
    invalid: boolean;
    onChange: (value: string) => void;
}) {
    const { locale } = useLocale();
    const copy = earlyBirdCopy[locale];
    const inputId = useId();
    const hintId = `${inputId}-hint`;
    const errorId = `${inputId}-error`;

    return (
        <div className="listener-checkout__payer-email">
            <label htmlFor={inputId}>{copy.checkoutMercadoPagoEmail}</label>
            <input
                id={inputId}
                className="listener-input"
                type="email"
                inputMode="email"
                autoComplete="email"
                spellCheck={false}
                maxLength={320}
                required
                disabled={disabled}
                value={value}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? `${hintId} ${errorId}` : hintId}
                onChange={(event) => onChange(event.target.value)}
            />
            <small id={hintId}>{copy.checkoutMercadoPagoEmailHint}</small>
            {invalid && <small id={errorId} role="alert">{copy.checkoutMercadoPagoEmailInvalid}</small>}
        </div>
    );
}
