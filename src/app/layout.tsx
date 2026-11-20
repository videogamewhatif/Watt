import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";

const figtree = Figtree({ variable: "--font-figtree", subsets: ["latin", "latin-ext"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Wattalis", template: "%s · Wattalis" },
  description: "Agenda y gestión de profesionales de salud para hospitales, clínicas y consultorios.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#175359",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-MX" className={`${figtree.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
