import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Forge Capital",
  description:
    "Fractional Forge's investor and customer outreach tracker.",
  applicationName: "Raise desk",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Raise desk",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f5f6f8",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-GB" className={inter.variable}>
      <body className="bg-bg text-text min-h-screen">{children}</body>
    </html>
  );
}
