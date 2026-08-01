'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type NavLink = {
    href: string;
    label: string;
    live?: boolean;
};

export default function OpsNavLinks({ links }: { links: NavLink[] }) {
    const pathname = usePathname();

    return (
        <>
            {links.map((link) => {
                const isActive =
                    pathname === link.href ||
                    (link.href !== '/ops/health' &&
                        pathname.startsWith(link.href));
                return (
                    <Link
                        key={link.href}
                        href={link.href}
                        aria-current={isActive ? 'page' : undefined}
                        className={`inline-flex min-h-11 items-center rounded-md px-3 py-2 text-xs transition-colors ${
                            isActive
                                ? 'bg-white/15 text-[var(--paper)]'
                                : 'text-[var(--text-secondary)] hover:bg-white/5 hover:text-[var(--paper)]'
                        }`}
                    >
                        {link.label}
                        {link.live && (
                            <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-[var(--lime)] align-middle" />
                        )}
                    </Link>
                );
            })}
        </>
    );
}
