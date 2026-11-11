"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";

const groups = [
  {
    label: "Your guests",
    items: [
      {
        label: "Dashboard",
        href: "/",
        icon: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
      },
      {
        label: "Invitations",
        href: "/invitations",
        icon: "M3 5h18v14H3zM3 5l9 8 9-8",
      },
      { label: "RSVPs", href: "/rsvps", icon: "M5 12l4 4L19 6M4 21h16" },
      {
        label: "Messages",
        href: "/messages",
        icon: "M3 4h18v13H8l-5 4zM7 8h10M7 12h6",
      },
    ],
  },
  {
    label: "Wedding day",
    items: [
      {
        label: "Guest reception",
        href: "/reception",
        icon: "M3 8V3h5M16 3h5v5M7 12l3 3 7-7",
      },
      {
        label: "Check-in",
        href: "/checkin",
        icon: "M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M7 12l3 3 7-7",
      },
      {
        label: "Reports",
        href: "/reports",
        icon: "M4 3v18h17M9 16V9M14 16V5M19 16v-5",
      },
    ],
  },
  {
    label: "Manage",
    items: [
      {
        label: "Events",
        href: "/events",
        icon: "M4 5h16v16H4zM8 2v6M16 2v6M4 11h16",
      },
      {
        label: "Event materials",
        href: "/event-content",
        icon: "M3 4h7l2 3h9v14H3zM8 12h8M8 16h5",
      },
      {
        label: "Staff",
        href: "/settings/staff",
        icon: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M2 21v-3a7 7 0 0 1 14 0v3M17 4a4 4 0 0 1 0 7M19 15a6 6 0 0 1 3 6",
      },
      {
        label: "Change password",
        href: "/account/password",
        icon: "M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4M12 14v3",
      },
    ],
  },
];
const destinations = groups.flatMap((group) => group.items);

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
        {groups.map((group) => (
          <div className="navigation-group" key={group.label}>
            <p className="navigation-group-label">{group.label}</p>
            <ul>
              {group.items.map((item) => (
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
                    <svg
                      className="navigation-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d={item.icon} />
                    </svg>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}
