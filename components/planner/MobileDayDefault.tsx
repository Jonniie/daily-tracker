"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Phones land on Day view when the URL doesn't pick one — the 7-day grid
 * stays one tap away via the Day/Week toggle. Runs once on mount; any
 * explicit `?view=` (including the user's later toggle clicks) wins.
 */
export function MobileDayDefault({
  hasViewParam,
  date,
}: {
  hasViewParam: boolean;
  date: string;
}) {
  const router = useRouter();

  useEffect(() => {
    if (hasViewParam) return;
    if (window.matchMedia("(max-width: 1023px)").matches) {
      router.replace(`/today?date=${date}&view=day`);
    }
  }, [hasViewParam, date, router]);

  return null;
}
