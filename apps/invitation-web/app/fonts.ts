import {
  Albert_Sans,
  Luxurious_Script,
  Parisienne,
  Spectral,
  TikTok_Sans,
} from "next/font/google";

export const spectral = Spectral({
  weight: ["400", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-spectral",
});

export const luxuriousScript = Luxurious_Script({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-luxurious-script",
});

export const parisienne = Parisienne({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-parisienne",
});

export const albertSans = Albert_Sans({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-albert-sans",
});

export const tiktokSans = TikTok_Sans({
  weight: ["300", "400", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-tiktok-sans",
});
