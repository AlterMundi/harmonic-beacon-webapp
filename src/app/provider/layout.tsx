import { BottomNav } from "@/components";

export default function ProviderLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen pb-24">
            {children}
            <BottomNav />
        </div>
    );
}
