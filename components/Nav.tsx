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
      <div className="mx-auto flex max-w-5xl items-center gap-1 px-4 py-2">
        <Link href="/" className="mr-auto text-sm font-black tracking-widest uppercase">
          TC<span className="text-flag">/</span>Engineer
        </Link>
        {LINKS.map((l) => {
          const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded px-3 py-2 text-xs font-bold tracking-wider uppercase ${active ? "bg-flag text-black" : "text-dim hover:text-ink"}`}
            >
              {l.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
