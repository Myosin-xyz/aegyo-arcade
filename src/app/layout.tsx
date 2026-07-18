import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Silkscreen } from "next/font/google";
import "./globals.css";
import { Suspense } from "react";
import { CampaignCapture } from "./campaign-capture";

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
  title: "Aegyo Arcade",
  description:
    "K-pop mini-games: play daily, keep your streak, top the boards.",
  icons: { apple: "/icons/apple-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#140a26",
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
          <CampaignCapture />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
