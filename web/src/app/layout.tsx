import type { Metadata } from "next";
import { Big_Shoulders, IBM_Plex_Mono, Public_Sans } from "next/font/google";
import "./globals.css";

const display = Big_Shoulders({
  variable: "--font-big-shoulders",
  subsets: ["latin"],
  axes: ["opsz"],
});

const text = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});

const measure = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Rollin'",
  description:
    "Drives your wheelchair through measured floor plans, shows which door stops it, and asks the landlord about the rest.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${text.variable} ${measure.variable} h-full`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
