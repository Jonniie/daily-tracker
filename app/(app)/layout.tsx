import Link from "next/link";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { NavLinks } from "@/components/ui/NavLinks";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-4 sm:px-6 lg:h-dvh lg:overflow-hidden">
      <header className="g-header -mx-4 flex items-center justify-between px-4 py-4 sm:-mx-6 sm:px-6">
        <Link
          href="/goals"
          className="font-display text-lg font-bold tracking-tight text-text-primary"
        >
          daily-tracker
        </Link>
        <nav className="flex items-center gap-1">
          <NavLinks />
          <ThemeToggle />
        </nav>
      </header>
      <main className="min-h-0 flex-1 pt-6 pb-4 lg:overflow-hidden">{children}</main>
    </div>
  );
}
