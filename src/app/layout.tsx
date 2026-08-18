import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import { LocaleProvider } from "@/context/LocaleContext";
import { GlobalNavigation } from "@/components/brand/GlobalNavigation";
import {
  globalNavigationAccountHref,
  globalNavigationSurface,
} from "@/lib/brand/global-navigation";
import { requestBrowserLocale, requestLocale } from "@/lib/i18n-server";
import { isCanonicalListenerHost } from "@/lib/listener/public-discovery";
import { isAccountHost } from "@/lib/account/config";
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

const eventMetadata: Metadata = {
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

const accountMetadata: Metadata = {
  title: "Account | Harmonic Beacon",
  description: "Manage your Harmonic Beacon identity, profile and sign-in methods.",
  authors: [{ name: "Harmonic Beacon" }],
  openGraph: {
    title: "Account | Harmonic Beacon",
    description: "Manage your Harmonic Beacon identity, profile and sign-in methods.",
    type: "website",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const incomingHeaders = await headers();
  return isAccountHost(incomingHeaders.get('host')) ? accountMetadata : eventMetadata;
}

export async function generateViewport(): Promise<Viewport> {
  const incomingHeaders = await headers();
  const accountHost = isAccountHost(incomingHeaders.get('host'));
  return {
    width: "device-width",
    initialScale: 1,
    themeColor: isCanonicalListenerHost(incomingHeaders) || accountHost ? "#16120D" : "#07120f",
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const incomingHeaders = await headers();
  // Listener content starts from the browser's primary language and then
  // honors the shared navigation preference. Keep that policy bound to the
  // exact public host so event-language defaults elsewhere remain untouched.
  const listenerHost = isCanonicalListenerHost(incomingHeaders);
  const accountHost = isAccountHost(incomingHeaders.get('host'));
  const accountNavSlot = accountHost && incomingHeaders.get('x-hb-account-nav-slot') === '1';
  const accountHref = globalNavigationAccountHref(incomingHeaders);
  // This application is the Live surface by default. Listener and its staging
  // host opt into their own active item explicitly; local/E2E hosts continue
  // to exercise the same global header as production Live.
  const navigationSurface = globalNavigationSurface(incomingHeaders) ?? "events";
  const accountLocale = incomingHeaders.get('x-hb-account-locale');
  const locale = listenerHost || accountHost
    ? accountHost && (accountLocale === 'es' || accountLocale === 'en')
      ? accountLocale
      : await requestBrowserLocale(incomingHeaders)
    : await requestLocale();

  return (
    <html
      lang={locale}
      data-lang={locale}
      data-hb-surface={listenerHost ? "listener" : accountHost ? "account" : undefined}
      className={`${cormorant.variable} ${inter.variable} ${syne.variable} ${spaceMono.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <GlobalNavigation
          active={navigationSurface}
          locale={locale}
          allowRemoteEnhancement={!accountNavSlot}
          accountHref={accountHref}
        />
        <LocaleProvider initialLocale={locale}>
          {/* Main content */}
          <div className="relative z-10">{children}</div>

          <Toaster
            theme="dark"
            position="top-center"
            toastOptions={{
              style: {
                background: listenerHost || accountHost ? "rgba(27, 21, 15, 0.97)" : "rgba(7, 18, 15, 0.96)",
                backdropFilter: "blur(16px)",
                border: listenerHost || accountHost
                  ? "1px solid rgba(201, 162, 78, 0.22)"
                  : "1px solid rgba(238, 245, 233, 0.12)",
                color: listenerHost || accountHost ? "#F4EEE2" : "#fff9e9",
                fontFamily: listenerHost || accountHost
                  ? "var(--font-hb-inter), Inter, system-ui, sans-serif"
                  : "var(--font-syne), system-ui, sans-serif",
                fontSize: "13px",
              },
            }}
          />
        </LocaleProvider>
      </body>
    </html>
  );
}
