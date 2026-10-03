"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/track", label: "Track" },
  { href: "/laps", label: "Laps" },
  { href: "/compare", label: "Compare" },
];

export function Nav() {
  const path = usePathname();
  if (path.startsWith("/session/")) return null; // live screen is distraction-free
  return (
    <nav className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-3 py-2 sm:px-4">
        <Link href="/" className="mr-auto shrink-0 text-sm font-black tracking-wider whitespace-nowrap uppercase sm:tracking-widest">
          TC<span className="text-flag">/</span>Engineer
        </Link>
        {/* links scroll horizontally instead of overflowing the page on narrow screens */}
        <div className="flex min-w-0 gap-0.5 overflow-x-auto [scrollbar-width:none] sm:gap-1">
          {LINKS.map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`shrink-0 rounded px-2 py-2 text-xs font-bold tracking-wide whitespace-nowrap uppercase sm:px-3 sm:tracking-wider ${active ? "bg-flag text-black" : "text-dim hover:text-ink"}`}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
