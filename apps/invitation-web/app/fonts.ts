import { Albert_Sans, Luxurious_Script, Spectral } from "next/font/google";

export const spectral = Spectral({
  weight: ["400", "700"],
  style: ["normal", "italic"],
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

export const albertSans = Albert_Sans({
  weight: ["400", "600"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-albert-sans",
});
