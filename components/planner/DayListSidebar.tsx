import Link from "next/link";
import { CalendarDays } from "lucide-react";
import type { DaySummaryDTO } from "@/lib/planner";
import { dayListLabel } from "@/lib/date-key";

/**
 * Sidebar list of days that have content, newest first. Clicking a date
 * anchors the week calendar to that day's week and selects its column.
 * Server component — active state comes from the URL via props.
 */
export function DayListSidebar({
  days,
  selectedDate,
  today,
}: {
  days: DaySummaryDTO[];
  selectedDate: string;
  today: string;
}) {
  return (
    <aside className="g-enter flex flex-col rounded-block bg-surface p-3 shadow-block lg:w-52 lg:shrink-0">
      <header className="mb-2 flex items-center gap-2 px-1">
        <CalendarDays size={14} className="text-text-secondary" />
        <h2 className="font-display text-xs font-bold tracking-wide text-text-secondary uppercase">
          Days
        </h2>
      </header>

      {days.length === 0 ? (
        <p className="px-1 text-sm text-text-secondary">
          Nothing logged yet — click a cell to add your first task.
        </p>
      ) : (
        <nav aria-label="Past days">
          <ul className="no-scrollbar flex gap-1 overflow-x-auto lg:max-h-64 lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto">
            {days.map((day) => {
              const active = day.date === selectedDate;
              return (
                <li key={day.date} className="shrink-0 lg:shrink">
                  <Link
                    href={`/today?date=${day.date}`}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center justify-between gap-3 rounded-sub px-2.5 py-2 text-sm whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${
                      active
                        ? "bg-primary-subtle font-semibold text-primary"
                        : "text-text-secondary hover:bg-surface-recessed hover:text-text-primary"
                    }`}
                  >
                    <span>{dayListLabel(day.date, today)}</span>
                    <span
                      className={`rounded-chip px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${
                        active ? "bg-primary/15 text-primary" : "bg-surface-recessed"
                      }`}
                    >
                      {day.blockCount}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </aside>
  );
}
