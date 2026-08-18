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
            >{revealed ? hideLabel : showLabel}</button>
        </span>
    </label>;
}
