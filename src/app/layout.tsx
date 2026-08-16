import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import { LocaleProvider } from "@/context/LocaleContext";
import { requestLocale } from "@/lib/i18n-server";
import { isCanonicalListenerHost, listenerLocaleForHeaders } from "@/lib/listener/public-discovery";
import "@/styles/hb-brand.css";
import "./globals.css";
import { Toaster } from "sonner";

const cormorant = localFont({
  src: [
    {
      path: "./fonts/cormorant-garamond/CormorantGaramond-wght.woff2",
      weight: "400 600",
      style: "normal",
    },
    {
      path: "./fonts/cormorant-garamond/CormorantGaramond-Italic-wght.woff2",
      weight: "400 600",
      style: "italic",
    },
  ],
  variable: "--font-cormorant",
  display: "swap",
});

const inter = localFont({
  src: "./fonts/inter/Inter-latin-wght.woff2",
  weight: "300 600",
  style: "normal",
  variable: "--font-hb-inter",
  display: "swap",
});

const syne = localFont({
  src: "./fonts/syne/Syne-wght.woff2",
  weight: "400 700",
  style: "normal",
  variable: "--font-syne",
  display: "swap",
});

const spaceMono = localFont({
  src: [
    {
      path: "./fonts/space-mono/SpaceMono-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/space-mono/SpaceMono-Bold.woff2",
      weight: "700",
      style: "normal",
    },
  ],
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
  const incomingHeaders = await headers();
  // Listener content and metadata use the browser's primary language. Bind
  // that behavior to the exact public host so event-language defaults on the
  // rest of the application remain untouched.
  const locale = isCanonicalListenerHost(incomingHeaders)
    ? listenerLocaleForHeaders(incomingHeaders)
    : await requestLocale();

  return (
    <html lang={locale} data-lang={locale} className={`${cormorant.variable} ${inter.variable} ${syne.variable} ${spaceMono.variable}`}>
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
