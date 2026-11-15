import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted (SIL OFL, see src/app/fonts) so builds never depend on a font CDN.
// Instrument Sans is one variable file: weight 400 to 700 and width 75 to 100. Declaring the
// width range lets `font-stretch` select condensed numerals from the same family.
const sans = localFont({
  src: "./fonts/instrument-sans-latin-variable.woff2",
  weight: "400 700",
  variable: "--font-instrument-sans",
  display: "swap",
  declarations: [{ prop: "font-stretch", value: "75% 100%" }],
});
const serif = localFont({
  src: [
    { path: "./fonts/instrument-serif-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/instrument-serif-latin-400-italic.woff2", weight: "400", style: "italic" },
  ],
  variable: "--font-instrument-serif",
  display: "swap",
});

/**
 * The site's public address. Link previews (WhatsApp, Messenger, iMessage, Slack) need absolute
 * addresses for the page and its image, and a crawler reads them from the first HTML it is sent.
 * Set NEXT_PUBLIC_SITE_URL for a custom domain; on Vercel the project's production address is used.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://stickman-seven-tau.vercel.app");
const TITLE = "ASCEND";
const DESCRIPTION = "A dark-fantasy action RPG. Claim the essence of your enemies and build an army.";
/** 1200x630 JPEG, under 100KB: the size and weight WhatsApp and Messenger show as a large preview. */
const PREVIEW = { url: "/og/ascend.jpg", width: 1200, height: 630, type: "image/jpeg", alt: "ASCEND: a white-cloaked warrior cuts through a line of dark figures on a dusk battlefield." };

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: TITLE,
  alternates: { canonical: "/" },
  openGraph: { type: "website", url: "/", siteName: TITLE, title: TITLE, description: DESCRIPTION, locale: "en_US", images: [PREVIEW] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [PREVIEW] },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: TITLE },
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0a0a0b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
