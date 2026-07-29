import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "Harmonic Beacon | Live Psychodrama",
  description: "Join a live bilingual psychodrama session with Julián and the Harmonic Beacon.",
  keywords: ["psychodrama", "live event", "bilingual", "harmonic beacon"],
  authors: [{ name: "Harmonic Beacon" }],
  openGraph: {
    title: "Harmonic Beacon | Live Psychodrama",
    description: "Join a live bilingual psychodrama session with Julián and the Harmonic Beacon.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a1a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {/* Background orbs - Adjusted for deep space feel */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
          <div className="bg-orb bg-orb-1 opacity-20 mix-blend-screen" />
          <div className="bg-orb bg-orb-2 opacity-15 mix-blend-screen" />
        </div>

        {/* Main content */}
        <div className="relative z-10">
          {children}
        </div>

        <Toaster
          theme="dark"
          position="top-center"
          toastOptions={{
            style: {
              background: 'rgba(0, 0, 0, 0.8)',
              backdropFilter: 'blur(16px)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#fff',
            },
          }}
        />
      </body>
    </html>
  );
}
