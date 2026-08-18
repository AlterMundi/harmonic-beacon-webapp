'use client';

import { useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
    label: string;
    showLabel: string;
    hideLabel: string;
};

/** Password input with a keyboard- and screen-reader-accessible reveal control. */
export function AccountPasswordField({ label, showLabel, hideLabel, ...input }: Props) {
    const [revealed, setRevealed] = useState(false);
    return <label>{label}
        <span className="account-password-field">
            <input {...input} type={revealed ? 'text' : 'password'} />
            <button
                type="button"
                className="account-password-toggle"
                aria-label={revealed ? hideLabel : showLabel}
                aria-pressed={revealed}
                onClick={() => setRevealed((value) => !value)}
            >
                {revealed ? (
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                        <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
                        <circle cx="12" cy="12" r="2.75" />
                    </svg>
                ) : (
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                        <path d="M3 3l18 18" />
                        <path d="M10.6 6.1A10.8 10.8 0 0 1 12 6c6 0 9.5 6 9.5 6a16.8 16.8 0 0 1-2.3 3.1M14.1 14.2a3 3 0 0 1-4.3-4.3M6.2 6.3C3.8 8 2.5 12 2.5 12s3.5 6 9.5 6c1.3 0 2.5-.3 3.5-.7" />
                    </svg>
                )}
            </button>
        </span>
    </label>;
}
