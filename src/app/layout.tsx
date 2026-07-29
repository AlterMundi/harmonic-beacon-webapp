import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AudioProvider } from "@/context/AudioContext";
import { Toaster } from "sonner";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

export const metadata: Metadata = {
  title: "Harmonic Beacon | Calm Through Sound",
  description: "Experience deep calm through live harmonic resonance. Connect with the Harmonic Beacon for meditation, relaxation, and better sleep.",
  keywords: ["meditation", "relaxation", "harmonic", "sound therapy", "sleep", "calm", "stress relief"],
  authors: [{ name: "Harmonic Beacon" }],
  openGraph: {
    title: "Harmonic Beacon | Calm Through Sound",
    description: "Experience deep calm through live harmonic resonance.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0a0a1a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      {/*
        No client-side session provider. The `hb_session` cookie is HttpOnly and
        every gate resolves it server-side, so there is no session for the browser
        to hold — and the landing page must render for a visitor who has none.
      */}
      <body className={`${inter.variable} antialiased`}>
        <AudioProvider>
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
        </AudioProvider>
      </body>
    </html>
  );
}
