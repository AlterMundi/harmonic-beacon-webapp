"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

export default function HomePage() {
  const router = useRouter();
  const { status } = useSession();

  useEffect(() => {
    if (status === "authenticated") {
      router.push('/live');
    } else if (status === "unauthenticated") {
      router.push('/login');
    }
  }, [status, router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-[var(--primary-600)] shadow-[0_0_30px_rgba(var(--primary-rgb),0.5)] animate-pulse"></div>
        <p className="text-[var(--text-muted)]">Loading...</p>
      </div>
    </div>
  );
}
