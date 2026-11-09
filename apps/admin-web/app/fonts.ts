import { Spectral, TikTok_Sans } from "next/font/google";

export const editorial = Spectral({
  weight: ["400", "600"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-editorial",
});

export const interfaceFont = TikTok_Sans({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-interface",
});
