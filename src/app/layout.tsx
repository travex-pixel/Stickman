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
  themeColor: "#0a0a0b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
