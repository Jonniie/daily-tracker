/**
 * Goal coverage: attribute scheduled/done block-hours to ROOT goals.
 * Pure — goals arrive flat (as persisted), blocks as minimal shapes.
 */
import type { Goal } from "./goals/types";

export interface CoverageBlock {
  /** Linked goal ids (any depth in the tree). */
  goalIds: string[];
  span: number;
  done: boolean;
}

export interface RootCoverage {
  rootId: string;
  title: string;
  plannedMin: number;
  doneMin: number;
}

export interface WeekCoverage {
  /** Roots with at least one planned hour, most-planned first. */
  byRoot: RootCoverage[];
  unallocatedPlannedMin: number;
  unallocatedDoneMin: number;
}

/**
 * A block's hours count toward each DISTINCT root its linked goals belong to
 * (a block serving two roots credits both — noted, not split). Blocks with
 * no goal links fall into the unallocated bucket.
 */
export function computeCoverage(goals: Goal[], blocks: CoverageBlock[]): WeekCoverage {
  const byId = new Map(goals.map((g) => [g.id, g]));

  const rootOf = (id: string): Goal | undefined => {
    let current = byId.get(id);
    let guard = 0;
    while (current?.parentId && guard++ < 1000) {
      current = byId.get(current.parentId);
    }
    return current;
  };

  const acc = new Map<string, RootCoverage>();
  let unallocatedPlannedMin = 0;
  let unallocatedDoneMin = 0;

  for (const block of blocks) {
    const minutes = block.span * 60;
    const roots = new Set<string>();
    for (const goalId of block.goalIds) {
      const root = rootOf(goalId);
      if (root) roots.add(root.id);
    }

    if (roots.size === 0) {
      unallocatedPlannedMin += minutes;
      if (block.done) unallocatedDoneMin += minutes;
      continue;
    }

    for (const rootId of roots) {
      const root = byId.get(rootId)!;
      const entry = acc.get(rootId) ?? {
        rootId,
        title: root.title,
        plannedMin: 0,
        doneMin: 0,
      };
      entry.plannedMin += minutes;
      if (block.done) entry.doneMin += minutes;
      acc.set(rootId, entry);
    }
  }

  return {
    byRoot: [...acc.values()]
      .filter((r) => r.plannedMin > 0)
      .sort((a, b) => b.plannedMin - a.plannedMin),
    unallocatedPlannedMin,
    unallocatedDoneMin,
  };
}
