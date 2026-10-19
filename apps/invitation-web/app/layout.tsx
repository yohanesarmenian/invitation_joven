import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "../components/invitation/figma-invitation-theme.css";

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
