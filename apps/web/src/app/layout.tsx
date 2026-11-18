import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const sans = Archivo({ subsets: ["latin"], variable: "--font-sans", axes: ["wdth"] });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.OS_PUBLIC_URL ?? "https://oracle-scout.vercel.app"),
  title: "Oracle Scout: evidence on the record",
  description:
    "An AI evidence agent with a provably human owner. Primary-data evidence, a hash-chained audit log anchored on Concordium, evidence packs sold over x402, MCP and A2A endpoints.",
  openGraph: { images: ["/cover.png"] },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EDF0EA" },
    { media: "(prefers-color-scheme: dark)", color: "#0F1B2E" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-paper">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
