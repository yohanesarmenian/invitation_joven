import type { ReactNode } from "react";
import {
  albertSans,
  luxuriousScript,
  parisienne,
  spectral,
  tiktokSans,
} from "../../fonts";

export default function PublicInvitationLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div
      className={[
        spectral.variable,
        luxuriousScript.variable,
        parisienne.variable,
        albertSans.variable,
        tiktokSans.variable,
      ].join(" ")}
    >
      {children}
    </div>
  );
}
