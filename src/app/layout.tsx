import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/gavel/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GAVEL — Forensic delivery-to-billing reconciliation",
  description:
    "GAVEL reads what was contracted (SOWs), what was built (GitHub/Jira), and what was invoiced — then surfaces the gap as an evidence-backed finding a human can approve and bill.",
  keywords: [
    "GAVEL",
    "revenue leakage",
    "audit",
    "professional services",
    "SOW reconciliation",
    "delivery evidence",
    "engineering audit",
  ],
  authors: [{ name: "GAVEL" }],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "GAVEL",
    description: "Forensic delivery-to-billing reconciliation for dev/IT services firms.",
    siteName: "GAVEL",
    type: "website",
    images: [{ url: "/og.png", width: 2400, height: 1260, alt: "GAVEL — forensic delivery-to-billing reconciliation" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "GAVEL",
    description: "Forensic delivery-to-billing reconciliation for dev/IT services firms.",
    images: ["/og.png"],
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
