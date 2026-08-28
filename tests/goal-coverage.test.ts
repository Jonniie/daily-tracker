import { describe, expect, it } from "vitest";
import { computeCoverage } from "@/lib/goal-coverage";
import type { Goal } from "@/lib/goals/types";

let seq = 0;
function goal(id: string, parentId: string | null, title = id): Goal {
  return {
    id,
    title,
    parentId,
    isCompleted: false,
    order: 0,
    category: null,
    userId: "u1",
    createdAt: new Date(1_700_000_000_000 + seq++ * 1000),
    updatedAt: new Date(1_700_000_000_000 + seq++ * 1000),
  };
}

// work ─ ocpp ─ ticket
// dsa
const goals = [
  goal("work", null),
  goal("ocpp", "work"),
  goal("ticket", "ocpp"),
  goal("dsa", null),
];

describe("computeCoverage", () => {
  it("attributes nested goal links to the root", () => {
    const cov = computeCoverage(goals, [
      { goalIds: ["ticket"], span: 2, done: true },
      { goalIds: ["ocpp"], span: 1, done: false },
    ]);
    expect(cov.byRoot).toHaveLength(1);
    expect(cov.byRoot[0]).toMatchObject({
      rootId: "work",
      plannedMin: 180,
      doneMin: 120,
    });
  });

  it("dedupes multiple links under the same root within one block", () => {
    const cov = computeCoverage(goals, [{ goalIds: ["ocpp", "ticket"], span: 1, done: false }]);
    expect(cov.byRoot[0].plannedMin).toBe(60);
  });

  it("credits each distinct root a multi-root block serves", () => {
    const cov = computeCoverage(goals, [{ goalIds: ["ticket", "dsa"], span: 2, done: false }]);
    expect(cov.byRoot).toHaveLength(2);
    expect(cov.byRoot.every((r) => r.plannedMin === 120)).toBe(true);
  });

  it("buckets goal-less blocks as unallocated", () => {
    const cov = computeCoverage(goals, [
      { goalIds: [], span: 2, done: true },
      { goalIds: ["dsa"], span: 1, done: false },
    ]);
    expect(cov.unallocatedPlannedMin).toBe(120);
    expect(cov.unallocatedDoneMin).toBe(120);
    expect(cov.byRoot[0].rootId).toBe("dsa");
  });

  it("omits roots with no planned hours", () => {
    const cov = computeCoverage(goals, []);
    expect(cov.byRoot).toEqual([]);
    expect(cov.unallocatedPlannedMin).toBe(0);
  });
});
