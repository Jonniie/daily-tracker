import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import type { Goal } from "@/lib/goals/types";
import { buildTree } from "@/lib/goals/tree";

beforeEach(() => {
  sendGoalToBacklog.mockClear();
  createExtraGoal.mockClear();
  updateGoalTitle.mockClear();
});

const sendGoalToBacklog = vi.fn(async (_input: { goalId: string }) => ({
  success: true,
  data: { already: false },
}));
const createExtraGoal = vi.fn(async (_input: { title: string }) => ({
  success: true,
  data: {
    id: "real-new",
    title: _input.title,
    parentId: null,
    isCompleted: false,
    order: 9,
    category: null,
    userId: "u1",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
}));
vi.mock("@/app/actions/planner", () => ({
  sendGoalToBacklog: (input: { goalId: string }) => sendGoalToBacklog(input),
  createExtraGoal: (input: { title: string }) => createExtraGoal(input),
  removeBacklogItem: vi.fn(async () => ({ success: true, data: { removed: true } })),
  carryOverBacklog: vi.fn(async () => ({ success: true, data: { moved: 1 } })),
}));
const updateGoalTitle = vi.fn(async (id: string, title: string) => ({
  success: true,
  data: { id, title },
}));
vi.mock("@/app/actions/goals", () => ({
  createGoal: vi.fn(async () => ({ success: true, data: { id: "real-x" } })),
  toggleGoal: vi.fn(async (id: string) => ({ success: true, data: { id } })),
  updateGoalTitle: (id: string, title: string) => updateGoalTitle(id, title),
  updateGoalCategory: vi.fn(async () => ({ success: true, data: {} })),
  deleteGoal: vi.fn(async () => ({ success: true, data: { deleted: 1 } })),
  reorderGoals: vi.fn(async () => ({ success: true, data: { reordered: 1 } })),
  moveGoal: vi.fn(async () => ({ success: true, data: {} })),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import { GoalTreeProvider } from "@/components/providers/GoalTreeProvider";
import { BacklogSection } from "@/components/planner/BacklogSection";

let seq = 0;
function row(id: string, parentId: string | null, title: string): Goal {
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

// gym (leaf) | work > ocpp (leaf)
function fixtureTree() {
  return buildTree([
    row("gym", null, "gym"),
    row("work", null, "work"),
    row("ocpp", "work", "ocpp work"),
  ]);
}

function renderExtras() {
  return render(
    <GoalTreeProvider initialTree={fixtureTree()}>
      <BacklogSection items={[]} />
    </GoalTreeProvider>,
  );
}

describe("Extras quick-add", () => {
  it("searches leaf goals and adds the picked one on Enter", async () => {
    const { getByRole, getByText } = renderExtras();
    const input = getByRole("combobox", { name: "Add an extra" });
    fireEvent.change(input, { target: { value: "gy" } });

    await waitFor(() => expect(getByText("gym")).toBeTruthy());
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(sendGoalToBacklog).toHaveBeenCalledWith({ goalId: "gym" }),
    );
    // lands optimistically as a plain-text row (no #tag chip)
    await waitFor(() => {
      const rows = document.querySelectorAll("ul li");
      expect(Array.from(rows).some((li) => li.textContent === "gym")).toBe(true);
    });
    expect((input as HTMLInputElement).value).toBe(""); // reset after add
  });

  it("offers create-on-the-fly when nothing matches, and adds the result", async () => {
    const { getByRole, getByText } = renderExtras();
    const input = getByRole("combobox", { name: "Add an extra" });
    fireEvent.change(input, { target: { value: "call accountant" } });

    const createOption = await waitFor(() => getByText(/Create “call accountant”/));
    expect(createOption).toBeTruthy();
    fireEvent.keyDown(input, { key: "ArrowDown" }); // only option is create
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(createExtraGoal).toHaveBeenCalledWith({ title: "call accountant" }),
    );
    // created title threads through immediately (no tree-sync flash)
    await waitFor(() => expect(getByText("call accountant")).toBeTruthy());
  });

  it("entry text is editable: click → input, Enter commits the rename", async () => {
    const { getByRole, getByLabelText, getByText } = renderExtras();
    const input = getByRole("combobox", { name: "Add an extra" });
    fireEvent.change(input, { target: { value: "gy" } });
    await waitFor(() => expect(getByText("gym")).toBeTruthy());
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(getByText("gym")).toBeTruthy());

    // click the row text → input appears pre-filled
    fireEvent.click(getByText("gym"));
    const editor = getByLabelText("Edit extra") as HTMLInputElement;
    expect(editor.value).toBe("gym");
    fireEvent.change(editor, { target: { value: "gym morning" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    // provider-level optimistic rename + action fired
    expect(updateGoalTitle).toHaveBeenCalledWith("gym", "gym morning");
    await waitFor(() => expect(getByText("gym morning")).toBeTruthy());
  });

  it("Escape cancels the edit and reverts the text", async () => {
    const { getByRole, getByLabelText, getByText, queryByLabelText } = renderExtras();
    const input = getByRole("combobox", { name: "Add an extra" });
    fireEvent.change(input, { target: { value: "gy" } });
    await waitFor(() => expect(getByText("gym")).toBeTruthy());
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(getByText("gym")).toBeTruthy());

    fireEvent.click(getByText("gym"));
    const editor = getByLabelText("Edit extra") as HTMLInputElement;
    fireEvent.change(editor, { target: { value: "nope" } });
    fireEvent.keyDown(editor, { key: "Escape" });

    expect(queryByLabelText("Edit extra")).toBeNull();
    expect(getByText("gym")).toBeTruthy();
    expect(updateGoalTitle).not.toHaveBeenCalled();
  });

  it("Escape closes the picker without adding", async () => {
    const { getByRole, queryByRole } = renderExtras();
    const input = getByRole("combobox", { name: "Add an extra" });
    fireEvent.change(input, { target: { value: "gy" } });
    await waitFor(() => expect(queryByRole("listbox")).not.toBeNull());
    fireEvent.keyDown(input, { key: "Escape" });
    expect(queryByRole("listbox")).toBeNull();
    expect(sendGoalToBacklog).not.toHaveBeenCalled();
  });
});
