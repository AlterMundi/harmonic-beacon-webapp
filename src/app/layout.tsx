import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AudioProvider } from "@/context/AudioContext";
import { AuthProvider } from "@/context/AuthContext";
import { AuthGuard } from "@/components/AuthGuard";
import { AudioPlayerProvider, MiniPlayer } from "@/components";

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
      <body className={`${inter.variable} antialiased`}>
        <AuthProvider>
          <AuthGuard>
            <AudioProvider>
              <AudioPlayerProvider>
                {/* Background orbs */}
                <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
                  <div className="bg-orb bg-orb-1" />
                  <div className="bg-orb bg-orb-2" />
                </div>

                {/* Mini Player for background audio */}
                <MiniPlayer />

                {/* Main content */}
                <div className="relative z-10">
                  {children}
                </div>
              </AudioPlayerProvider>
            </AudioProvider>
          </AuthGuard>
        </AuthProvider>
      </body>
    </html>
  );
}
