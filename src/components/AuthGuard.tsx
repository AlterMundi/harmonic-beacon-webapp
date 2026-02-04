"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export function AuthGuard({ children }: { children: React.ReactNode }) {
    const { user, isLoading } = useAuth();
    const router = useRouter();
    const pathname = usePathname();

    // Public routes that don't require authentication
    const publicRoutes = ['/login', '/signup', '/auth/callback'];
    const isPublicRoute = publicRoutes.some(route => pathname?.startsWith(route));

    useEffect(() => {
        if (!isLoading) {
            // If not authenticated and trying to access protected route, redirect to login
            if (!user && !isPublicRoute) {
                router.push('/login');
            }
            // If authenticated and on login/signup, redirect to /live
            else if (user && (pathname === '/login' || pathname === '/signup')) {
                router.push('/live');
            }
        }
    }, [user, isLoading, pathname, router, isPublicRoute]);

    // Show loading state while checking auth
    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-[var(--primary-600)] shadow-[0_0_30px_rgba(var(--primary-rgb),0.5)] animate-pulse"></div>
                    <p className="text-[var(--text-muted)]">Loading...</p>
                </div>
            </div>
        );
    }

    // Don't render protected content if not authenticated
    if (!user && !isPublicRoute) {
        return null;
    }

    return <>{children}</>;
}
