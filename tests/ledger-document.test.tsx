import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/app/actions/planner", () => ({
  sendGoalToBacklog: vi.fn(async () => ({ success: true, data: { already: false } })),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import { GoalTreeProvider } from "@/components/providers/GoalTreeProvider";
import { LedgerDocument } from "@/components/planner/LedgerDocument";
import { buildTree } from "@/lib/goals/tree";
import type { Goal } from "@/lib/goals/types";
import type { DailyPlannerDTO } from "@/lib/planner";

function fixturePlanner(): DailyPlannerDTO {
  return {
    date: "2026-08-27",
    timeBlocks: [
      { id: "b1", hour: 9, span: 2, task: "deep work", goalIds: ["g1"], done: true },
      { id: "b2", hour: 14, span: 1, task: "review", goalIds: [], done: false },
    ],
    backlog: [{ id: "i1", goalId: "g1", note: null }],
    ledger: [
      { id: "e2", kind: "did", text: "Did “deep work” (9 AM–11 AM)", at: "2026-08-27T11:05:00" },
      { id: "e1", kind: "planned", text: "Planned “deep work” at 9 AM (2h)", at: "2026-08-27T08:30:00" },
    ],
  };
}

function fixtureTree() {
  const g: Goal = {
    id: "g1",
    title: "ship daily-tracker",
    parentId: null,
    isCompleted: false,
    order: 0,
    category: null,
    userId: "u1",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return buildTree([g]);
}

describe("LedgerDocument", () => {
  it("renders blocks with ranges/done marks, backlog chips, and the ledger chronologically", () => {
    const { getByText, getAllByText, container } = render(
      <GoalTreeProvider initialTree={fixtureTree()}>
        <LedgerDocument planner={fixturePlanner()} />
      </GoalTreeProvider>,
    );
    expect(getByText("Field log").className).toContain("uppercase");
    expect(getByText("9 AM–11 AM")).toBeTruthy();
    expect(getByText("2 PM–3 PM")).toBeTruthy();
    expect(getByText("Done")).toBeTruthy();
    expect(getAllByText(/#ship-daily-tracker/).length).toBeGreaterThan(0);

    // ledger oldest-first (document order)
    const texts = Array.from(container.querySelectorAll("li")).map((li) => li.textContent);
    const plannedIdx = texts.findIndex((t) => t?.includes("Planned"));
    const didIdx = texts.findIndex((t) => t?.includes("Did"));
    expect(plannedIdx).toBeLessThan(didIdx);
  });

  it("renders the empty state when nothing was recorded", () => {
    const { getByText } = render(
      <GoalTreeProvider initialTree={[]}>
        <LedgerDocument
          planner={{ date: "2026-08-27", timeBlocks: [], backlog: [], ledger: [] }}
        />
      </GoalTreeProvider>,
    );
    expect(getByText(/Nothing recorded/)).toBeTruthy();
  });
});
