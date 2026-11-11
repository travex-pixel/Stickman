import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted (SIL OFL, see src/app/fonts) so builds never depend on a font CDN.
const marcellus = localFont({ src: "./fonts/marcellus-latin-400-normal.woff2", weight: "400", variable: "--font-marcellus", display: "swap" });
const manrope = localFont({
  src: [
    { path: "./fonts/manrope-latin-500-normal.woff2", weight: "500" },
    { path: "./fonts/manrope-latin-600-normal.woff2", weight: "600" },
    { path: "./fonts/manrope-latin-700-normal.woff2", weight: "700" },
    { path: "./fonts/manrope-latin-800-normal.woff2", weight: "800" },
  ],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ASCEND",
  description: "A dark-fantasy action RPG. Claim the essence of your enemies and build an army.",
  applicationName: "ASCEND",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "ASCEND" },
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0d1016",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${marcellus.variable} ${manrope.variable}`}>
      <body>{children}</body>
    </html>
  );
}
