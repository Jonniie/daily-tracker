import { describe, expect, it } from "vitest";
import {
  addBlockLocal,
  moveBlockLocal,
  patchBlockLocal,
  removeBlockLocal,
  resizeBlockLocal,
} from "@/lib/planner-ops";
import type { DayPlannerDTO, TimeBlockDTO } from "@/lib/planner";

function block(hour: number, span = 1, task = `task@${hour}`): TimeBlockDTO {
  return { id: `b-${hour}`, hour, span, task, goalIds: [], done: false };
}

function days(): DayPlannerDTO[] {
  return [
    { date: "2026-08-27", timeBlocks: [block(9, 2, "deep work"), block(14)] },
    { date: "2026-08-28", timeBlocks: [] },
  ];
}

describe("moveBlockLocal (span-aware)", () => {
  it("moves a multi-hour block to a free range", () => {
    const next = moveBlockLocal(days(), { date: "2026-08-27", hour: 9 }, { date: "2026-08-27", hour: 16 });
    expect(next).not.toBeNull();
    const moved = next![0].timeBlocks.find((b) => b.task === "deep work")!;
    expect(moved.hour).toBe(16);
    expect(moved.span).toBe(2);
  });

  it("rejects a move whose span would collide", () => {
    // 9–10 block moved to 13 would cover 13–14, but 14 is taken
    expect(
      moveBlockLocal(days(), { date: "2026-08-27", hour: 9 }, { date: "2026-08-27", hour: 13 }),
    ).toBeNull();
  });

  it("rejects moving onto a covered cell", () => {
    // 10 is covered by the 9–10 block
    expect(
      moveBlockLocal(days(), { date: "2026-08-27", hour: 14 }, { date: "2026-08-27", hour: 10 }),
    ).toBeNull();
  });

  it("moves across days", () => {
    const next = moveBlockLocal(days(), { date: "2026-08-27", hour: 14 }, { date: "2026-08-28", hour: 8 });
    expect(next![0].timeBlocks).toHaveLength(1);
    expect(next![1].timeBlocks[0].hour).toBe(8);
  });
});

describe("addBlockLocal", () => {
  it("inserts into an empty cell", () => {
    const next = addBlockLocal(days(), { date: "2026-08-27", hour: 12 }, block(12, 1, "new"));
    expect(next![0].timeBlocks.map((b) => b.task)).toContain("new");
  });

  it("rejects occupied and covered cells", () => {
    expect(addBlockLocal(days(), { date: "2026-08-27", hour: 14 }, block(14))).toBeNull();
    expect(addBlockLocal(days(), { date: "2026-08-27", hour: 10 }, block(10))).toBeNull();
  });
});

describe("resizeBlockLocal", () => {
  it("grows a block into free cells", () => {
    const next = resizeBlockLocal(days(), { date: "2026-08-27", hour: 9 }, 4);
    expect(next![0].timeBlocks.find((b) => b.hour === 9)!.span).toBe(4);
  });

  it("rejects growth into an occupied cell", () => {
    expect(resizeBlockLocal(days(), { date: "2026-08-27", hour: 9 }, 6)).toBeNull(); // would hit 14
  });

  it("shrinks freely", () => {
    const next = resizeBlockLocal(days(), { date: "2026-08-27", hour: 9 }, 1);
    expect(next![0].timeBlocks.find((b) => b.hour === 9)!.span).toBe(1);
  });
});

describe("removeBlockLocal", () => {
  it("removes the block at the cell", () => {
    const next = removeBlockLocal(days(), { date: "2026-08-27", hour: 14 });
    expect(next![0].timeBlocks).toHaveLength(1);
  });

  it("returns null for an empty cell", () => {
    expect(removeBlockLocal(days(), { date: "2026-08-27", hour: 8 })).toBeNull();
  });
});

describe("patchBlockLocal", () => {
  it("patches a block's fields (e.g. done)", () => {
    const next = patchBlockLocal(days(), { date: "2026-08-27", hour: 9 }, { done: true });
    expect(next![0].timeBlocks.find((b) => b.hour === 9)!.done).toBe(true);
  });

  it("returns null for an empty cell", () => {
    expect(patchBlockLocal(days(), { date: "2026-08-27", hour: 7 }, { done: true })).toBeNull();
  });
});
