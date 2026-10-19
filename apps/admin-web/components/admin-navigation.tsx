"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";

const destinations = [
  { label: "Dashboard", href: "/" },
  { label: "Invitations", href: "/invitations" },
  { label: "RSVPs", href: "/rsvps" },
  { label: "Messages", href: "/messages" },
  { label: "Check-in", href: "/checkin" },
  { label: "Staff", href: "/settings/staff" },
  { label: "Reports", href: "/reports" },
  { label: "Event materials", href: "/event-content" },
  { label: "Events", href: "/events" },
];

export function isCurrentSection(pathname: string, href: string) {
  return href === "/"
    ? pathname === "/"
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNavigation() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const current = destinations.find((item) =>
    isCurrentSection(pathname, item.href),
  )?.label;
  return (
    <div
      className="navigation"
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded) {
          setExpanded(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="navigation-toggle"
        aria-expanded={expanded}
        aria-controls="primary-navigation"
        onClick={() => setExpanded(!expanded)}
      >
        <span>{expanded ? "Close navigation" : "Open navigation"}</span>
        <span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>
      <p className="mobile-current">Current section: {current ?? "Admin"}</p>
      <nav
        id="primary-navigation"
        aria-label="Primary navigation"
        className={
          expanded ? "primary-navigation is-open" : "primary-navigation"
        }
      >
        <ul>
          {destinations.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                prefetch={false}
                aria-current={
                  isCurrentSection(pathname, item.href) ? "page" : undefined
                }
                onClick={() => {
                  setExpanded(false);
                  trigger.current?.focus();
                }}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
