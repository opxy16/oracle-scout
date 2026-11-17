import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.OS_PUBLIC_URL ?? "https://oracle-scout.vercel.app"),
  title: "Oracle Scout — accountable evidence agent",
  description:
    "An AI evidence agent with a verified human owner. Primary-data evidence, a hash-chained audit log anchored on Concordium, evidence packs sold over x402, MCP and A2A endpoints.",
  openGraph: { images: ["/cover.png"] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
