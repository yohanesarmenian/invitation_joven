import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./editorial.css";
import { editorial, interfaceFont } from "./fonts";

export const metadata: Metadata = {
  title: "HeyJo — Wedding Workspace",
  description: "Jo and Venta’s wedding invitation workspace.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${editorial.variable} ${interfaceFont.variable}`}>
        {children}
      </body>
    </html>
  );
}
