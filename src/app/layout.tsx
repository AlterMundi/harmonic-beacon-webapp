import type { Metadata, Viewport } from "next";
import { Syne, Space_Mono } from "next/font/google";
import localFont from "next/font/local";
import { headers } from "next/headers";
import { GlobalNavigation } from "@/components/brand/GlobalNavigation";
import { LiveIdentityCacheBoundary } from "@/components/brand/LiveIdentityCacheBoundary";
import { LiveNavigationAccountMenu } from "@/components/brand/LiveNavigationAccountMenu";
import { LocaleProvider } from "@/context/LocaleContext";
import { beaconAccountEnabled } from "@/lib/account-rp";
import {
  globalNavigationAccountHref,
  globalNavigationSurface,
} from "@/lib/brand/global-navigation";
import { locallyKnownLiveNavigationIdentity } from "@/lib/brand/account-navigation-state";
import { analyticsBrowserConfig } from "@/lib/analytics-browser";
import { requestLocale } from "@/lib/i18n-server";
import { messages } from "@/lib/i18n";
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
  themeColor: "#16120D",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const incomingHeaders = await headers();
  const locale = await requestLocale();
  const navigationSurface = globalNavigationSurface(incomingHeaders) ?? "events";
  const accountHref = globalNavigationAccountHref(incomingHeaders);
  const accountAvailable = beaconAccountEnabled();
  const navigationIdentity = accountAvailable
    ? await locallyKnownLiveNavigationIdentity(incomingHeaders).catch(() => null)
    : null;
  const analytics = analyticsBrowserConfig(incomingHeaders);

  return (
    <html lang={locale} data-lang={locale} className={`${cormorant.variable} ${inter.variable} ${syne.variable} ${spaceMono.variable}`}>
      <body className="antialiased">
        {analytics ? <script
          defer
          src={`${analytics.collector}/v1/tracker.js`}
          data-collector={analytics.collector}
          data-surface={analytics.surface}
          data-environment={analytics.environment}
        /> : null}
        <GlobalNavigation
          active={navigationSurface}
          locale={locale}
          accountHref={accountHref}
          accountAvailable={accountAvailable}
          accountSignedIn={Boolean(navigationIdentity)}
          accountMenu={navigationIdentity ? (
            <LiveNavigationAccountMenu
              displayName={navigationIdentity.displayName}
              staffRoleLabel={navigationIdentity.staffRole
                ? messages[locale].staffRoles[navigationIdentity.staffRole]
                : null}
              accountHref={accountHref}
              locale={locale}
            />
          ) : undefined}
        />
        {navigationIdentity && <LiveIdentityCacheBoundary />}
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
