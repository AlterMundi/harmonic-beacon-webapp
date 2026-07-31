import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Syne, Space_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
  display: "swap",
});

const syne = Syne({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-syne",
  display: "swap",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Harmonic Projection | Harmonic Beacon",
  description:
    "A live online experience to enter your inner landscape through body, sound and the images already living inside you.",
  keywords: ["harmonic projection", "live event", "bilingual", "harmonic beacon", "psychodrama"],
  authors: [{ name: "Harmonic Beacon" }],
  openGraph: {
    title: "Harmonic Projection | Harmonic Beacon",
    description:
      "A live online experience to enter your inner landscape through body, sound and the images already living inside you.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#080B16",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${cormorant.variable} ${syne.variable} ${spaceMono.variable}`}>
      <body className="antialiased">
        {/* Restrained dark event atmosphere */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
          <div
            className="absolute opacity-[0.04]"
            style={{
              width: "600px",
              height: "600px",
              borderRadius: "50%",
              filter: "blur(120px)",
              background: "radial-gradient(circle, rgba(158,114,255,0.3), transparent 70%)",
              top: "-10%",
              right: "-5%",
            }}
          />
          <div
            className="absolute opacity-[0.03]"
            style={{
              width: "500px",
              height: "500px",
              borderRadius: "50%",
              filter: "blur(100px)",
              background: "radial-gradient(circle, rgba(99,237,255,0.2), transparent 70%)",
              bottom: "10%",
              left: "-10%",
            }}
          />
        </div>

        {/* Main content */}
        <div className="relative z-10">{children}</div>

        <Toaster
          theme="dark"
          position="top-center"
          toastOptions={{
            style: {
              background: "rgba(8, 11, 22, 0.96)",
              backdropFilter: "blur(16px)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              color: "#FFF6DF",
              fontFamily: "var(--font-syne), system-ui, sans-serif",
              fontSize: "13px",
            },
          }}
        />
      </body>
    </html>
  );
}
