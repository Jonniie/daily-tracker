"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

/**
 * Icon visibility is driven by the `.dark` class (applied pre-paint by
 * next-themes' inline script), so no mounted-state dance is needed.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      aria-label="Toggle color theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="inline-flex h-9 w-9 items-center justify-center rounded-chip text-text-secondary transition-colors hover:bg-surface-recessed hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <Sun size={16} strokeWidth={2} className="hidden dark:block" />
      <Moon size={16} strokeWidth={2} className="block dark:hidden" />
    </button>
  );
}
