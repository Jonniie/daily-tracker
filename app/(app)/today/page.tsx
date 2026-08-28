import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getGoalTree } from "@/lib/goals/queries";
import {
  getDailyPlanner,
  getWeekCoverage,
  getWeekPlanner,
  listRecentDays,
} from "@/lib/planner";
import {
  dayFullLabel,
  isValidDateKey,
  isoWeekNumber,
  nowMinutesInAppTz,
  shiftDateKey,
  todayKey,
  weekLabel,
  weekRangeLabel,
} from "@/lib/date-key";
import { GoalTreeProvider } from "@/components/providers/GoalTreeProvider";
import { WeekCalendar } from "@/components/planner/WeekCalendar";
import { MobileDayDefault } from "@/components/planner/MobileDayDefault";
import { DayListSidebar } from "@/components/planner/DayListSidebar";
import { BacklogSection } from "@/components/planner/BacklogSection";
import { GoalCoveragePanel } from "@/components/planner/GoalCoveragePanel";

// Reads SQLite at request time — never prerender at build.
export const dynamic = "force-dynamic";

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string }>;
}) {
  const params = await searchParams;
  const today = todayKey();
  const anchor = isValidDateKey(params.date) ? params.date : today;
  const view = params.view === "day" ? "day" : "grid";

  const yesterdayKey = shiftDateKey(today, -1);
  const [tree, week, todayPlanner, recentDays, yesterdayPlanner, coverage] =
    await Promise.all([
      getGoalTree(),
      getWeekPlanner(anchor),
      getDailyPlanner(today), // backlog + ledger are always today's (the send/log target)
      listRecentDays(30),
      getDailyPlanner(yesterdayKey), // rollover source
      getWeekCoverage(anchor),
    ]);

  return (
    <GoalTreeProvider initialTree={tree}>
      <MobileDayDefault hasViewParam={typeof params.view === "string"} date={anchor} />
      <div className="flex flex-col gap-4 lg:h-full lg:min-h-0 lg:flex-row">
        <div className="order-2 flex shrink-0 flex-col gap-4 lg:order-1 lg:h-full lg:min-h-0 lg:w-56 lg:overflow-y-auto">
          <DayListSidebar days={recentDays} selectedDate={anchor} today={today} />
          <GoalCoveragePanel coverage={coverage} />
        </div>

        <div className="order-1 flex min-w-0 flex-col lg:order-2 lg:min-h-0 lg:flex-1">
          <div className="mb-4 flex shrink-0 items-center justify-between">
            <div>
              <h1 className="page-title g-enter">
                {view === "day" ? dayFullLabel(anchor) : weekLabel(week.weekStart)}
              </h1>
              <p
                className="page-subtitle g-enter mt-1 tabular-nums"
                style={{ "--stagger": "60ms" } as React.CSSProperties}
              >
                Week {isoWeekNumber(anchor)} · {weekRangeLabel(week.weekStart)}
                {anchor === today && " · Today"}
              </p>
            </div>
            <nav
              className="flex items-center gap-1"
              aria-label={view === "day" ? "Change day" : "Change week"}
            >
              <NavButton
                href={`/today?date=${shiftDateKey(anchor, view === "day" ? -1 : -7)}&view=${view}`}
                label={view === "day" ? "Previous day" : "Previous week"}
              >
                <ChevronLeft size={16} />
              </NavButton>
              <Link
                href={`/today?view=${view}`}
                className={`g-btn rounded-chip px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                  anchor === today
                    ? "bg-primary text-primary-foreground"
                    : "text-text-secondary hover:bg-surface-recessed hover:text-text-primary"
                }`}
              >
                Today
              </Link>
              <NavButton
                href={`/today?date=${shiftDateKey(anchor, view === "day" ? 1 : 7)}&view=${view}`}
                label={view === "day" ? "Next day" : "Next week"}
              >
                <ChevronRight size={16} />
              </NavButton>
            </nav>
          </div>

          <WeekCalendar
            week={week}
            today={today}
            selectedDate={anchor}
            orientation={view}
            initialNowMinutes={nowMinutesInAppTz()}
          />
          <BacklogSection
            items={todayPlanner.backlog}
            rollover={
              yesterdayPlanner.backlog.length > 0
                ? {
                    fromDate: yesterdayKey,
                    toDate: today,
                    count: yesterdayPlanner.backlog.length,
                  }
                : undefined
            }
          />
        </div>
      </div>
    </GoalTreeProvider>
  );
}

function NavButton({
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
