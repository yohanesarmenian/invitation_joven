import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "../components/invitation/romantic-invitation-theme.css";
import "../components/invitation/editorial-envelope.css";

export const metadata: Metadata = {
  title: "Wedding Invitation",
  description: "Public wedding invitation application foundation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
