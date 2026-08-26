import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/shipledger/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ShipLedger — Forensic delivery-to-billing reconciliation",
  description:
    "ShipLedger reads what was contracted (SOWs), what was built (GitHub/Jira), and what was invoiced — then surfaces the gap as an evidence-backed finding a human can approve and bill.",
  keywords: [
    "ShipLedger",
    "revenue leakage",
    "audit",
    "professional services",
    "SOW reconciliation",
    "delivery evidence",
    "engineering audit",
  ],
  authors: [{ name: "ShipLedger" }],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "ShipLedger",
    description: "Forensic delivery-to-billing reconciliation for dev/IT services firms.",
    siteName: "ShipLedger",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ShipLedger",
    description: "Forensic delivery-to-billing reconciliation for dev/IT services firms.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          {children}
          <Toaster position="bottom-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
