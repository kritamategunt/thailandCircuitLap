import type { Metadata, Viewport } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "TC Track Engineer",
  description: "Phone-GPS lap timer and AI Track Engineer for Thailand Circuit",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#09090b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <div className="chequer h-1 w-full opacity-60" />
        <Nav />
        <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-4">{children}</main>
      </body>
    </html>
  );
}
