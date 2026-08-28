import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getGoalTree } from "@/lib/goals/queries";
import { getDailyPlanner } from "@/lib/planner";
import {
  dayFullLabel,
  isValidDateKey,
  isoWeekNumber,
  shiftDateKey,
  todayKey,
} from "@/lib/date-key";
import { GoalTreeProvider } from "@/components/providers/GoalTreeProvider";
import { LedgerDocument } from "@/components/planner/LedgerDocument";

// Reads SQLite at request time — never prerender at build.
export const dynamic = "force-dynamic";

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const today = todayKey();
  const date = isValidDateKey(params.date) ? params.date : today;

  const [tree, planner] = await Promise.all([getGoalTree(), getDailyPlanner(date)]);

  return (
    <GoalTreeProvider initialTree={tree}>
      <div className="mx-auto h-full w-full max-w-2xl overflow-y-auto pb-16">
        <div className="mb-5 flex items-center justify-between gap-2">
          <div>
            <h1 className="page-title g-enter">Ledger</h1>
            <p
              className="page-subtitle g-enter mt-1 tabular-nums"
              style={{ "--stagger": "60ms" } as React.CSSProperties}
            >
              {dayFullLabel(date)} · Week {isoWeekNumber(date)}
              {date === today && " · Today"}
            </p>
          </div>
          <nav className="flex shrink-0 items-center gap-1" aria-label="Change day">
            <DayLink href={`/ledger?date=${shiftDateKey(date, -1)}`} label="Previous day">
              <ChevronLeft size={16} />
            </DayLink>
            {date !== today && (
              <Link
                href="/ledger"
                className="g-btn rounded-chip px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-recessed hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                Today
              </Link>
            )}
            <DayLink href={`/ledger?date=${shiftDateKey(date, 1)}`} label="Next day">
              <ChevronRight size={16} />
            </DayLink>
          </nav>
        </div>

        <LedgerDocument planner={planner} />
      </div>
    </GoalTreeProvider>
  );
}

function DayLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-chip text-text-secondary transition-colors hover:bg-surface-recessed hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {children}
    </Link>
  );
}
