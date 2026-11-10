import type { ReactNode } from "react";
import { albertSans, luxuriousScript, spectral } from "../../fonts";

export default function PublicInvitationLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div
      className={[
        "public-invitation-theme",
        spectral.variable,
        luxuriousScript.variable,
        albertSans.variable,
      ].join(" ")}
    >
      {children}
    </div>
  );
}
