"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/upcoming", label: "Upcoming" },
  { href: "/ipos", label: "All IPOs" },
  { href: "/events", label: "Lock-in Events" },
  { href: "/review", label: "Needs Review" },
  { href: "/sources", label: "Sources" },
  { href: "/sync", label: "Sync History" },
];

export function NavLinks({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const links = isAdmin ? [...LINKS, { href: "/admin", label: "Admin" }] : LINKS;
  return (
    <nav className="flex items-center gap-1 overflow-x-auto text-[13px]">
      {links.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`px-2.5 py-1 rounded whitespace-nowrap transition-colors ${
              active ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
