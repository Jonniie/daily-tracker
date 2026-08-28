import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { weekDays, weekStartKey } from "./date-key";
import { computeCoverage, type WeekCoverage } from "./goal-coverage";

/* ------------------------------------------------------------------ */
/* DTOs (client components never see Prisma rows)                      */
/* ------------------------------------------------------------------ */

export interface TimeBlockDTO {
  id: string;
  hour: number;
  /** Length in whole hours (≥1). Cells it covers have no row of their own. */
  span: number;
  task: string;
  goalIds: string[];
  /** True once the block was marked done. */
  done: boolean;
}

export interface LedgerEntryDTO {
  id: string;
  kind: string;
  text: string;
  /** ISO timestamp. */
  at: string;
}

export interface BacklogItemDTO {
  id: string;
  goalId: string;
  note: string | null;
}

export interface DailyPlannerDTO {
  date: string;
  timeBlocks: TimeBlockDTO[];
  backlog: BacklogItemDTO[];
  ledger: LedgerEntryDTO[];
}

export interface DayPlannerDTO {
  date: string;
  timeBlocks: TimeBlockDTO[];
}

export interface WeekPlannerDTO {
  /** Sunday date key of the displayed week. */
  weekStart: string;
  days: DayPlannerDTO[];
}

export interface DaySummaryDTO {
  date: string;
  blockCount: number;
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

/**
 * Fetch one day's planner (time blocks + backlog). Days are created lazily:
 * a day with no content returns empty arrays instead of a row.
 */
export async function getDailyPlanner(date: string): Promise<DailyPlannerDTO> {
  const userId = await getUserId();
  const note = await prisma.dailyNote.findUnique({
    where: { userId_date: { userId, date } },
    include: {
      timeBlocks: { include: { goalLinks: true }, orderBy: { hour: "asc" } },
      backlogItems: { orderBy: { createdAt: "asc" } },
      ledger: { orderBy: { createdAt: "desc" } },
    },
  });

  return {
    date,
    timeBlocks:
      note?.timeBlocks.map((b) => ({
        id: b.id,
        hour: b.hour,
        task: b.task,
        span: b.span,
        goalIds: b.goalLinks.map((l) => l.goalId),
        done: b.doneAt !== null,
      })) ?? [],
    backlog:
      note?.backlogItems.map((b) => ({
        id: b.id,
        goalId: b.goalId,
        note: b.note,
      })) ?? [],
    ledger:
      note?.ledger.map((e) => ({
        id: e.id,
        kind: e.kind,
        text: e.text,
        at: e.createdAt.toISOString(),
      })) ?? [],
  };
}

/**
 * Fetch the Sunday-start week containing `anchorDate` in one query.
 * Days without content return empty timeBlocks (days are created lazily).
 */
export async function getWeekPlanner(anchorDate: string): Promise<WeekPlannerDTO> {
  const userId = await getUserId();
  const weekStart = weekStartKey(anchorDate);
  const dates = weekDays(weekStart);

  const notes = await prisma.dailyNote.findMany({
    where: { userId, date: { in: dates } },
    include: { timeBlocks: { include: { goalLinks: true } } },
  });
  const byDate = new Map(notes.map((n) => [n.date, n]));

  return {
    weekStart,
    days: dates.map((date) => ({
      date,
      timeBlocks: (byDate.get(date)?.timeBlocks ?? [])
        .sort((a, b) => a.hour - b.hour)
        .map((b) => ({
          id: b.id,
          hour: b.hour,
          task: b.task,
          span: b.span,
          goalIds: b.goalLinks.map((l) => l.goalId),
          done: b.doneAt !== null,
        })),
    })),
  };
}

/**
 * Weekly goal coverage: planned/done hours per ROOT goal for the week
 * containing `anchorDate`, plus the unallocated (goal-less) bucket.
 * The math lives in lib/goal-coverage (pure, tested); this is just plumbing.
 */
export async function getWeekCoverage(anchorDate: string): Promise<WeekCoverage> {
  const userId = await getUserId();
  const dates = weekDays(weekStartKey(anchorDate));
  const [goals, notes] = await Promise.all([
    prisma.goal.findMany({ where: { userId } }),
    prisma.dailyNote.findMany({
      where: { userId, date: { in: dates } },
      include: { timeBlocks: { include: { goalLinks: true } } },
    }),
  ]);

  const blocks = notes.flatMap((n) =>
    n.timeBlocks.map((b) => ({
      goalIds: b.goalLinks.map((l) => l.goalId),
      span: b.span,
      done: b.doneAt !== null,
    })),
  );
  return computeCoverage(goals, blocks);
}

/**
 * Most recent days that have a daily note (created lazily on first content),
 * newest first — drives the sidebar day list.
 */
export async function listRecentDays(limit = 30): Promise<DaySummaryDTO[]> {
  const userId = await getUserId();
  const notes = await prisma.dailyNote.findMany({
    where: { userId },
    orderBy: { date: "desc" },
    take: limit,
    include: { _count: { select: { timeBlocks: true, backlogItems: true } } },
  });
  return notes.map((n) => ({
    date: n.date,
    blockCount: n._count.timeBlocks + n._count.backlogItems,
  }));
}
