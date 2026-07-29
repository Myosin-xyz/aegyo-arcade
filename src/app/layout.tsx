import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Silkscreen } from "next/font/google";
import "./globals.css";
import { Suspense } from "react";
import { AnalyticsBootstrap } from "./analytics-bootstrap";
import { LocaleBoundary } from "./locale-boundary";

const GOOGLE_ANALYTICS_ID = "G-700MXJM1FW";
const googleAnalyticsEnabled =
  process.env.VERCEL_ENV === "production" ||
  (!process.env.VERCEL_ENV && process.env.NODE_ENV === "production");

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Arcade display face — headings and short labels only.
const silkscreen = Silkscreen({
  variable: "--font-arcade",
  weight: ["400", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Aegyo Arena",
  description:
    "K-pop mini-games: play daily, keep your streak, top the boards.",
  icons: { apple: "/icons/apple-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#140a26",
  // Draw edge-to-edge in installed/standalone mode so env(safe-area-*)
  // resolves to real notch/home-indicator insets (audit B1); without
  // this the insets are always 0.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${silkscreen.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Suspense fallback={null}>
          <AnalyticsBootstrap
            enabled={googleAnalyticsEnabled}
            measurementId={GOOGLE_ANALYTICS_ID}
          />
        </Suspense>
        <LocaleBoundary>{children}</LocaleBoundary>
      </body>
    </html>
  );
}
