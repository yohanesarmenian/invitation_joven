import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "../components/invitation/romantic-invitation-theme.css";
import "../components/invitation/editorial-envelope.css";

export const metadata: Metadata = {
  title: "Undangan Pernikahan",
  description: "Undangan pernikahan Yohanes dan Angelina.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
