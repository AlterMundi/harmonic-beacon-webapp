"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
    {
        name: "Live",
        href: "/live",
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
            </svg>
        ),
    },
    {
        name: "Meditate",
        href: "/meditation",
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="1" />
                <path d="M12 2a7 7 0 0 0-7 7v4a7 7 0 0 0 14 0V9a7 7 0 0 0-7-7Z" />
                <path d="M12 16v5" />
            </svg>
        ),
    },
    {
        name: "Sessions",
        href: "/sessions",
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
            </svg>
        ),
    },
    {
        name: "Profile",
        href: "/profile",
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
            </svg>
        ),
    },
];

export default function BottomNav() {
    const pathname = usePathname();

    return (
        <nav className="fixed bottom-0 left-0 right-0 z-50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="max-w-lg mx-auto tab-nav">
                {tabs.map((tab) => {
                    const isActive = pathname === tab.href || (pathname === "/" && tab.href === "/live");
                    return (
                        <Link
                            key={tab.name}
                            href={tab.href}
                            className={`tab-item ${isActive ? "active" : ""}`}
                        >
                            {tab.icon}
                            <span>{tab.name}</span>
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}
