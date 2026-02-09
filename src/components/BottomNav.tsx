"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";

interface Tab {
    name: string;
    href: string;
    prefix?: string;
    icon: React.ReactNode;
}

const tabs: Tab[] = [
    {
        name: "Live",
        href: "/live",
        icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="3" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
            </svg>
        ),
    },
    {
        name: "Meditate",
        href: "/meditation",
        icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
            </svg>
        ),
    },
    {
        name: "Sessions",
        href: "/sessions",
        icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        ),
    },
    {
        name: "Profile",
        href: "/profile",
        icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
        ),
    },
];

export default function BottomNav() {
    const pathname = usePathname();
    const { data: session } = useSession();
    const userRole = session?.user?.role;
    const isProviderOrAdmin = userRole === "PROVIDER" || userRole === "ADMIN";

    // Always show strict tabs: Live, Meditate, Sessions, Profile
    const navTabs: Tab[] = [...tabs];

    if (isProviderOrAdmin) {
        navTabs.splice(2, 0, {
            name: "Studio",
            href: "/provider/dashboard",
            prefix: "/provider",
            icon: (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
            ),
        });
    }

    if (userRole === "ADMIN") {
        // Insert Admin before Profile (last item)
        navTabs.splice(navTabs.length - 1, 0, {
            name: "Admin",
            href: "/admin",
            prefix: "/admin",
            icon: (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                </svg>
            ),
        });
    }

    return (
        <nav className="fixed bottom-0 left-0 right-0 z-50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className={`max-w-lg mx-auto flex justify-center gap-1 p-1 bg-black/20 backdrop-blur-xl border border-white/10 rounded-2xl shadow-xl`}>
                {navTabs.map((tab) => {
                    const isActive = pathname === tab.href
                        || (pathname === "/" && tab.href === "/live")
                        || (tab.prefix ? pathname.startsWith(tab.prefix) : false);
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
