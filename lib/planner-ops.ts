import type { DayPlannerDTO, TimeBlockDTO } from "./planner";
import { rangeFree } from "./time-span";

/**
 * Optimistic local week mutations (client-side; the server re-validates).
 * All return new arrays or null when the operation collides with an
 * existing block (span-aware via rangeFree). Client-safe — type-only
 * dependency on the planner DTOs.
 */

export interface CellRef {
  date: string;
  hour: number;
}

/** Move a block (with its span) to another cell; null when occupied. */
export function moveBlockLocal(
  days: DayPlannerDTO[],
  from: CellRef,
  to: CellRef,
): DayPlannerDTO[] | null {
  const block = days
    .find((d) => d.date === from.date)
    ?.timeBlocks.find((b) => b.hour === from.hour);
  if (!block) return null;
  const toDay = days.find((d) => d.date === to.date);
  if (!toDay) return null;
  const others =
    from.date === to.date
      ? toDay.timeBlocks.filter((b) => b.hour !== from.hour)
      : toDay.timeBlocks;
  if (!rangeFree(others, to.hour, block.span)) return null;

  return days.map((d) => {
    if (from.date === to.date && d.date === from.date) {
      return {
        ...d,
        timeBlocks: [
          ...d.timeBlocks.filter((b) => b.hour !== from.hour),
          { ...block, hour: to.hour },
        ],
      };
    }
    if (d.date === from.date) {
      return { ...d, timeBlocks: d.timeBlocks.filter((b) => b.hour !== from.hour) };
    }
    if (d.date === to.date) {
      return { ...d, timeBlocks: [...d.timeBlocks, { ...block, hour: to.hour }] };
    }
    return d;
  });
}

/** Insert a new block (backlog drop); null when occupied. */
export function addBlockLocal(
  days: DayPlannerDTO[],
  to: CellRef,
  block: TimeBlockDTO,
): DayPlannerDTO[] | null {
  const day = days.find((d) => d.date === to.date);
  if (!day) return null;
  if (!rangeFree(day.timeBlocks, to.hour, block.span)) return null;
  return days.map((d) =>
    d.date === to.date ? { ...d, timeBlocks: [...d.timeBlocks, block] } : d,
  );
}

/** Resize a block; null when the new span collides. */
export function resizeBlockLocal(
  days: DayPlannerDTO[],
  at: CellRef,
  span: number,
): DayPlannerDTO[] | null {
  const day = days.find((d) => d.date === at.date);
  const block = day?.timeBlocks.find((b) => b.hour === at.hour);
  if (!day || !block) return null;
  if (!rangeFree(day.timeBlocks, at.hour, span, at.hour)) return null;
  return days.map((d) =>
    d.date === at.date
      ? {
          ...d,
          timeBlocks: d.timeBlocks.map((b) => (b.hour === at.hour ? { ...b, span } : b)),
        }
      : d,
  );
}

/** Remove a block; null when no block starts at that cell. */
export function removeBlockLocal(
  days: DayPlannerDTO[],
  at: CellRef,
): DayPlannerDTO[] | null {
  const day = days.find((d) => d.date === at.date);
  if (!day || !day.timeBlocks.some((b) => b.hour === at.hour)) return null;
  return days.map((d) =>
    d.date === at.date
      ? { ...d, timeBlocks: d.timeBlocks.filter((b) => b.hour !== at.hour) }
      : d,
  );
}

/** Patch a block's fields in place; null when no block starts at that cell. */
export function patchBlockLocal(
  days: DayPlannerDTO[],
  at: CellRef,
  patch: Partial<TimeBlockDTO>,
): DayPlannerDTO[] | null {
  const day = days.find((d) => d.date === at.date);
  if (!day || !day.timeBlocks.some((b) => b.hour === at.hour)) return null;
  return days.map((d) =>
    d.date === at.date
      ? {
          ...d,
          timeBlocks: d.timeBlocks.map((b) => (b.hour === at.hour ? { ...b, ...patch } : b)),
        }
      : d,
  );
}
