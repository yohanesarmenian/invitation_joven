import type { ComponentPropsWithoutRef, ReactNode } from "react";

export type FeedbackTone = "success" | "error" | "warning" | "info";
export function ActionFeedback({
  tone = "info",
  children,
  className = "",
  ...props
}: ComponentPropsWithoutRef<"div"> & {
  tone?: FeedbackTone;
  children: ReactNode;
}) {
  if (children === "") return null;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-atomic="true"
      {...props}
      className={`action-feedback action-feedback--${tone} ${className}`}
    >
      {children}
    </div>
  );
}
