import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { weekDays } from "@/lib/date-key";
import type { WeekPlannerDTO } from "@/lib/planner";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const deleteTimeBlock = vi.fn(async (_input: { date: string; hour: number }) => ({
  success: true,
  data: { deleted: true },
}));
const toggleTimeBlockDone = vi.fn(async (_input: { date: string; hour: number }) => ({
  success: true,
  data: { done: true },
}));
const unlinkGoalFromTimeBlock = vi.fn(
  async (_input: { date: string; hour: number; goalId: string }) => ({
    success: true,
    data: { unlinked: true },
  }),
);
vi.mock("@/app/actions/planner", () => ({
  deleteTimeBlock: (input: { date: string; hour: number }) => deleteTimeBlock(input),
  toggleTimeBlockDone: (input: { date: string; hour: number }) => toggleTimeBlockDone(input),
  moveTimeBlock: vi.fn(async () => ({ success: true, data: { moved: true } })),
  planBacklogItem: vi.fn(async () => ({ success: true, data: { planned: true } })),
  setTimeBlockSpan: vi.fn(async () => ({ success: true, data: { span: 2 } })),
  unlinkGoalFromTimeBlock: (input: { date: string; hour: number; goalId: string }) =>
    unlinkGoalFromTimeBlock(input),
  upsertTimeBlockTask: vi.fn(async () => ({ success: true, data: { id: "b1" } })),
  linkGoalToTimeBlock: vi.fn(async () => ({ success: true, data: { linked: true } })),
  sendGoalToBacklog: vi.fn(async () => ({ success: true, data: { already: false } })),
  removeBacklogItem: vi.fn(async () => ({ success: true, data: { removed: true } })),
  carryOverBacklog: vi.fn(async () => ({ success: true, data: { moved: 1 } })),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import { GoalTreeProvider } from "@/components/providers/GoalTreeProvider";
import { WeekCalendar } from "@/components/planner/WeekCalendar";
import { buildTree } from "@/lib/goals/tree";
import type { Goal } from "@/lib/goals/types";

function fixtureGoalTree() {
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

const SELECTED = "2026-08-27"; // a Thursday
const START = "2026-08-23";

function fixtureWeek(): WeekPlannerDTO {
  return {
    weekStart: START,
    days: weekDays(START).map((date) => ({
      date,
      timeBlocks:
        date === SELECTED
          ? [{ id: "b1", hour: 9, span: 2, task: "deep work", goalIds: ["g1"], done: false }]
          : [],
    })),
  };
}

function renderCalendar(withGoals = false) {
  return render(
    <GoalTreeProvider initialTree={withGoals ? fixtureGoalTree() : []}>
      <WeekCalendar
        week={fixtureWeek()}
        today={SELECTED}
        selectedDate={SELECTED}
        orientation="day"
        initialNowMinutes={60}
      />
    </GoalTreeProvider>,
  );
}

describe("WeekCalendar block deletion", () => {
  it("opens the cell editor and deletes the block after a confirming click", async () => {
    const { getByLabelText, queryByLabelText, getByText, queryByText, getByDisplayValue } =
      renderCalendar();

    // 9 AM holds a 2h block; 10 AM is covered (click-through) — sanity first
    expect(getByText("deep work")).toBeTruthy();
    expect(getByLabelText(/continues from 9 AM/i)).toBeTruthy();

    fireEvent.click(getByLabelText(/Edit THU 9 AM: deep work/i));

    // editor open (portalled): task text is the input's value; the block stays
    // visible underneath, so scope editor assertions to the popover.
    expect(getByDisplayValue("deep work")).toBeTruthy();
    const popover = document.querySelector("[data-anchored-popover]");
    expect(popover).not.toBeNull();
    expect(within(popover as HTMLElement).getByText("2h")).toBeTruthy();
    const deleteBtn = within(popover as HTMLElement).getByLabelText("Delete task");
    fireEvent.click(deleteBtn); // arms only — block still there
    expect(queryByLabelText(/Add task THU at 9 AM/i)).toBeNull();
    fireEvent.click(within(popover as HTMLElement).getByLabelText("Click again to confirm delete"));

    await waitFor(() => expect(queryByText("deep work")).toBeNull());
    // covered cell freed too, cell back to add-state
    expect(getByLabelText(/Add task THU at 9 AM/i)).toBeTruthy();
    expect(queryByLabelText(/continues from 9 AM/i)).toBeNull();
    expect(deleteTimeBlock).toHaveBeenCalledWith({ date: SELECTED, hour: 9 });
  });

  it("unlinking a goal tag in the editor is optimistic (chip disappears immediately)", async () => {
    const { getByLabelText, queryByLabelText, queryByText } =
      renderCalendar(true);

    fireEvent.click(getByLabelText(/Edit THU 9 AM: deep work/i));
    // chip shows in the block AND the editor overlay (both read block.goalIds)
    expect(document.querySelectorAll("[data-anchored-popover]")).toHaveLength(1);
    const popover = document.querySelector("[data-anchored-popover]") as HTMLElement;
    expect(within(popover).getByText(/ship-daily-tracker/)).toBeTruthy();

    fireEvent.click(within(popover).getByLabelText(/Unlink/));
    expect(unlinkGoalFromTimeBlock).toHaveBeenCalledWith({
      date: SELECTED,
      hour: 9,
      goalId: "g1",
    });
    // both copies of the chip disappear (shared optimistic state)
    await waitFor(() => expect(queryByText(/ship-daily-tracker/)).toBeNull());
    expect(queryByLabelText(/Unlink/)).toBeNull();
  });

  it("marks a block done from its checkbox (dims + strikes, no editor open)", async () => {
    const { getByLabelText, getByText } = renderCalendar();

    const doneBtn = getByLabelText("Mark as done");
    expect(doneBtn.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(doneBtn);

    expect(toggleTimeBlockDone).toHaveBeenCalledWith({ date: SELECTED, hour: 9 });
    // optimistic: checkbox flips and the task strikes through
    await waitFor(() =>
      expect(getByLabelText("Mark as not done").getAttribute("aria-checked")).toBe("true"),
    );
    expect(getByText("deep work").className).toContain("line-through");
    // editor never opened
    expect(getByText("deep work")).toBeTruthy();
  });
});

describe("WeekCalendar # goal picker", () => {
  it("opens the picker in a body portal (no clipping by scroll containers), Escape closes", async () => {
    const { getByLabelText, getByRole } = renderCalendar(true);

    // open an empty cell's editor and type the mention trigger
    fireEvent.click(getByLabelText(/Add task THU at 12 PM/i));
    const input = getByRole("combobox");
    fireEvent.change(input, { target: { value: "#" } });

    await waitFor(() => {
      const listbox = document.body.querySelector('[role="listbox"]');
      expect(listbox).not.toBeNull();
      expect(listbox!.parentElement?.parentElement).toBe(document.body); // portalled
      expect(listbox!.textContent).toContain("ship daily-tracker");
    });

    fireEvent.keyDown(input, { key: "Escape" });
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
  });
});
