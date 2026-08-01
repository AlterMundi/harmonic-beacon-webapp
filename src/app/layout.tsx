import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Syne, Space_Mono } from "next/font/google";
import { LocaleProvider } from "@/context/LocaleContext";
import { requestLocale } from "@/lib/i18n-server";
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
  themeColor: "#07120f",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await requestLocale();

  return (
    <html lang={locale} data-lang={locale} className={`${cormorant.variable} ${syne.variable} ${spaceMono.variable}`}>
      <body className="antialiased">
        <LocaleProvider initialLocale={locale}>
          {/* Main content */}
          <div className="relative z-10">{children}</div>

          <Toaster
            theme="dark"
            position="top-center"
            toastOptions={{
              style: {
                background: "rgba(7, 18, 15, 0.96)",
                backdropFilter: "blur(16px)",
                border: "1px solid rgba(238, 245, 233, 0.12)",
                color: "#fff9e9",
                fontFamily: "var(--font-syne), system-ui, sans-serif",
                fontSize: "13px",
              },
            }}
          />
        </LocaleProvider>
      </body>
    </html>
  );
}
