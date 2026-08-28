import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import type { Goal } from "@/lib/goals/types";
import { buildTree } from "@/lib/goals/tree";

/* Mock the server-action modules — tests exercise the optimistic client layer. */
const renameCategorySpy = vi.fn(async (_from: string, _to: string) => ({
  success: true,
  data: { updated: 2 },
}));
const deleteCategorySpy = vi.fn(async (_name: string) => ({
  success: true,
  data: { cleared: 2 },
}));
let created = 0;
vi.mock("@/app/actions/goals", () => ({
  createGoal: vi.fn(async (input: { title: string; parentId?: string | null; index?: number }) => ({
    success: true,
    data: {
      id: `real-${++created}`,
      title: input.title,
      parentId: input.parentId ?? null,
      isCompleted: false,
      order: input.index ?? 0,
      category: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: "u1",
    },
  })),
  toggleGoal: vi.fn(async (id: string) => ({ success: true, data: { id } })),
  updateGoalTitle: vi.fn(async (id: string, title: string) => ({
    success: true,
    data: { id, title },
  })),
  updateGoalCategory: vi.fn(async (id: string, category: string | null) => ({
    success: true,
    data: { id, category },
  })),
  renameCategory: (...a: unknown[]) => renameCategorySpy(...(a as [string, string])),
  deleteCategory: (...a: unknown[]) => deleteCategorySpy(...(a as [string])),
  deleteGoal: vi.fn(async () => ({ success: true, data: { deleted: 1 } })),
  reorderGoals: vi.fn(async () => ({ success: true, data: { reordered: 1 } })),
  moveGoal: vi.fn(async (input: { id: string }) => ({ success: true, data: { id: input.id } })),
}));
vi.mock("@/app/actions/planner", () => ({
  sendGoalToBacklog: vi.fn(async () => ({ success: true, data: { already: false } })),
  upsertTimeBlockTask: vi.fn(async () => ({ success: true, data: { id: "b1" } })),
  linkGoalToTimeBlock: vi.fn(async () => ({ success: true, data: { linked: true } })),
  unlinkGoalFromTimeBlock: vi.fn(async () => ({ success: true, data: { unlinked: true } })),
  moveTimeBlock: vi.fn(async () => ({ success: true, data: { moved: true } })),
  removeBacklogItem: vi.fn(async () => ({ success: true, data: { removed: true } })),
}));
const toastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: (...a: unknown[]) => toastInfo(...a), success: vi.fn() },
}));

import { GoalTreeProvider } from "@/components/providers/GoalTreeProvider";
import { OutlinerRoot } from "@/components/goals/OutlinerRoot";

/* ------------------------------ helpers ------------------------------ */

let seq = 0;
function row(id: string, parentId: string | null, order: number, over: Partial<Goal> = {}): Goal {
  return {
    id,
    title: over.title ?? id,
    parentId,
    isCompleted: false,
    order,
    category: null,
    userId: "u1",
    createdAt: new Date(1_700_000_000_000 + seq++ * 1000),
    updatedAt: new Date(1_700_000_000_000 + seq++ * 1000),
    ...over,
  };
}

/**
 * work
 * ├─ ocpp work
 * │   └─ weekly ticket
 * └─ admin
 * dsa
 */
function fixtureTree() {
  return buildTree([
    row("work", null, 0, { title: "work", category: "Work" }),
    row("dsa", null, 1, { title: "dsa" }),
    row("ocpp", "work", 0, { title: "ocpp work" }),
    row("admin", "work", 1, { title: "admin" }),
    row("ticket", "ocpp", 0, { title: "weekly ticket" }),
  ]);
}

function renderOutliner() {
  const utils = render(
    <GoalTreeProvider initialTree={fixtureTree()}>
      <OutlinerRoot />
    </GoalTreeProvider>,
  );
  const editorOf = (id: string): HTMLElement => {
    const el = utils.container.querySelector(
      `[data-goal-id="${id}"] [data-goal-editor]`,
    );
    if (!(el instanceof HTMLElement)) throw new Error(`no editor for ${id}`);
    return el;
  };
  const rowOf = (id: string): HTMLElement => {
    const el = utils.container.querySelector(`[data-goal-id="${id}"] [data-goal-row]`);
    if (!(el instanceof HTMLElement)) throw new Error(`no row for ${id}`);
    return el;
  };
  return { ...utils, editorOf, rowOf };
}

function setCaret(el: HTMLElement, offset: number) {
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  if (el.firstChild && el.firstChild.nodeType === Node.TEXT_NODE) {
    range.setStart(el.firstChild, Math.min(offset, el.textContent?.length ?? 0));
  } else {
    range.selectNodeContents(el);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function press(el: HTMLElement, key: string, opts: Partial<KeyboardEventInit> = {}) {
  fireEvent.keyDown(el, { key, bubbles: true, ...opts });
}

/** Title text of every visible row, in visible order. */
function visibleTitles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-goal-editor]")).map(
    (el) => el.textContent ?? "",
  );
}

beforeEach(() => {
  created = 0;
  toastInfo.mockClear();
});

/* ------------------------------- tests ------------------------------- */

describe("outliner keyboard model", () => {
  it("clicking a row's padding focuses its title editor", () => {
    const { rowOf, editorOf } = renderOutliner();
    const row = rowOf("ocpp");
    // click a non-interactive part of the row (the row itself)
    fireEvent.click(row);
    expect(document.activeElement).toBe(editorOf("ocpp"));
  });

  it("Enter at end creates an empty sibling below and focuses it", async () => {
    const { editorOf, container } = renderOutliner();
    const editor = editorOf("dsa");
    setCaret(editor, 3);
    press(editor, "Enter");
    await waitFor(() => {
      expect(visibleTitles(container)).toEqual([
        "work",
        "ocpp work",
        "weekly ticket",
        "admin",
        "dsa",
        "",
      ]);
    });
    const active = document.activeElement as HTMLElement;
    expect(active.hasAttribute("data-goal-editor")).toBe(true);
    expect(active.textContent).toBe("");
  });

  it("Enter mid-text splits the title at the caret", () => {
    const { editorOf, container } = renderOutliner();
    const editor = editorOf("ocpp");
    setCaret(editor, 4); // "ocpp| work"
    press(editor, "Enter");
    // Depth-first order: "ocpp" keeps its child "weekly ticket"; the new
    // sibling "work" lands after that subtree, before "admin"; "dsa" is root 2.
    const titles = visibleTitles(container);
    expect(titles).toEqual(["work", "ocpp", "weekly ticket", "work", "admin", "dsa"]);
  });

  it("Enter on an empty item closes the entry and focuses the previous line", async () => {
    const { editorOf, container } = renderOutliner();
    // create an empty bullet after "dsa"
    const editor = editorOf("dsa");
    setCaret(editor, 3);
    press(editor, "Enter");
    await waitFor(() => expect(visibleTitles(container)).toHaveLength(6));
    const empty = document.activeElement as HTMLElement;
    expect(empty.textContent).toBe("");
    // Enter again on the empty bullet → closes it, focus returns to dsa
    press(empty, "Enter");
    await waitFor(() => expect(visibleTitles(container)).toHaveLength(5));
    expect(document.activeElement).toBe(editorOf("dsa"));
  });

  it("blurring a never-titled empty item removes it", async () => {
    const { container, getByRole } = renderOutliner();
    fireEvent.click(getByRole("button", { name: /new goal/i }));
    fireEvent.click(getByRole("button", { name: /new goal/i }));
    await waitFor(() => expect(visibleTitles(container)).toContain(""));
    const empty = document.activeElement as HTMLElement;
    expect(empty.textContent).toBe("");
    fireEvent.blur(empty);
    await waitFor(() => expect(visibleTitles(container)).not.toContain(""));
  });

  it("clearing an existing title and blurring restores the saved title", () => {
    const { editorOf } = renderOutliner();
    const editor = editorOf("dsa");
    editor.focus();
    editor.textContent = "";
    fireEvent.blur(editor);
    expect(editorOf("dsa").textContent).toBe("dsa");
  });

  it("Tab nests under the preceding sibling, Shift+Tab outdents after the former parent", () => {
    const { editorOf, container } = renderOutliner();
    const dsaEditor = editorOf("dsa");
    setCaret(dsaEditor, 1);
    press(dsaEditor, "Tab");
    // dsa becomes last child of work (after admin)
    expect(visibleTitles(container)).toEqual([
      "work",
      "ocpp work",
      "weekly ticket",
      "admin",
      "dsa",
    ]);
    const nested = container.querySelector('[data-goal-id="dsa"]');
    expect(nested?.closest('[data-goal-id="work"]')).not.toBeNull();

    // focus survived the reparent remount
    const refocused = document.activeElement as HTMLElement;
    expect(refocused.hasAttribute("data-goal-editor")).toBe(true);

    press(refocused, "Tab", { shiftKey: true });
    // dsa is a root again, immediately after work
    const dsaAfter = container.querySelector('[data-goal-id="dsa"]');
    expect(dsaAfter?.parentElement?.closest("[data-goal-id]")).toBeNull();
    const rootOrder = Array.from(
      container.querySelectorAll('[role="tree"] > section'),
    ).map((s) => s.querySelector("[data-goal-editor]")?.textContent);
    expect(rootOrder).toEqual(["work", "dsa"]);
  });

  it("Backspace on an empty item deletes it and focuses the previous line's end", async () => {
    const { editorOf, container } = renderOutliner();
    const editor = editorOf("dsa");
    setCaret(editor, 3);
    press(editor, "Enter"); // empty sibling
    const empty = document.activeElement as HTMLElement;
    press(empty, "Backspace");
    await waitFor(() => expect(visibleTitles(container)).toHaveLength(5));
    expect(document.activeElement).toBe(editorOf("dsa"));
  });

  it("Backspace on an item with children is blocked with a hint", () => {
    const { editorOf } = renderOutliner();
    const editor = editorOf("ocpp");
    editor.focus();
    editor.textContent = "";
    press(editor, "Backspace");
    expect(toastInfo).toHaveBeenCalled();
    expect(editorOf("ocpp")).toBeTruthy(); // still there
  });

  it("ArrowUp/ArrowDown move focus across visible lines", () => {
    const { editorOf } = renderOutliner();
    const ticket = editorOf("ticket");
    setCaret(ticket, 0);
    press(ticket, "ArrowUp");
    expect(document.activeElement).toBe(editorOf("ocpp"));
    press(editorOf("ocpp"), "ArrowDown");
    expect(document.activeElement).toBe(editorOf("ticket"));
    press(editorOf("ticket"), "ArrowDown");
    expect(document.activeElement).toBe(editorOf("admin"));
  });

  it("delete button needs a confirming second click, then removes the subtree", () => {
    const { container } = renderOutliner();
    const host = container.querySelector('[data-goal-id="ocpp"] [data-goal-row]');
    const btn = host?.querySelector('button[aria-label="Delete goal"]');
    if (!(btn instanceof HTMLElement)) throw new Error("no delete button");

    fireEvent.click(btn); // first click arms only
    expect(visibleTitles(container)).toContain("ocpp work");
    expect(btn.textContent).toBe("Sure?");

    fireEvent.click(btn); // confirm
    expect(visibleTitles(container)).not.toContain("ocpp work");
    expect(visibleTitles(container)).not.toContain("weekly ticket"); // subtree gone
  });

  it("Cmd/Ctrl+Backspace force-deletes a non-empty goal with children", () => {
    const { editorOf, container } = renderOutliner();
    const editor = editorOf("ocpp"); // has text AND a child
    setCaret(editor, 2);
    press(editor, "Backspace", { metaKey: true });
    expect(visibleTitles(container)).not.toContain("ocpp work");
    expect(visibleTitles(container)).not.toContain("weekly ticket");
    // focus handed to the previous visible line ("work")
    expect(document.activeElement).toBe(editorOf("work"));
  });

  it("plain Backspace still does nothing on a non-empty line", () => {
    const { editorOf, container } = renderOutliner();
    const editor = editorOf("dsa");
    setCaret(editor, 0);
    press(editor, "Backspace");
    expect(visibleTitles(container)).toContain("dsa");
  });

  it("Cmd/Ctrl+Enter toggles completion from the keyboard", () => {
    const { editorOf, container } = renderOutliner();
    const checkboxOf = (id: string) => {
      const el = container.querySelector(
        `[data-goal-id="${id}"] button[role="checkbox"]`,
      );
      if (!(el instanceof HTMLElement)) throw new Error(`no checkbox for ${id}`);
      return el;
    };
    const editor = editorOf("dsa");
    setCaret(editor, 1);
    press(editor, "Enter", { metaKey: true });
    expect(checkboxOf("dsa").getAttribute("aria-checked")).toBe("true");
    press(editor, "Enter", { ctrlKey: true });
    expect(checkboxOf("dsa").getAttribute("aria-checked")).toBe("false");
  });

  it("category picker: mousedown inside the portalled popover does not close it (regression)", async () => {
    const { rowOf } = renderOutliner();
    const row = rowOf("dsa");

    fireEvent.click(row.querySelector('button[aria-label="Add category"]')!);
    const dialog = document.body.querySelector('[role="dialog"][aria-label="Set category"]');
    expect(dialog).not.toBeNull();

    // realistic event order: mousedown lands BEFORE click — used to close
    // the popover instantly (containment check didn't know about the portal)
    const workChip = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent === "Work" && dialog!.contains(b),
    );
    if (!workChip) throw new Error("no Work suggestion chip");
    fireEvent.mouseDown(workChip);
    expect(
      document.body.querySelector('[role="dialog"][aria-label="Set category"]'),
    ).not.toBeNull(); // still open after mousedown
    fireEvent.click(workChip);

    // applied optimistically: dsa now wears the Work pill
    await waitFor(() => {
      expect(row.querySelector('button[aria-label="Edit category (Work)"]')).not.toBeNull();
    });
  });

  it("category picker: mousedown outside the popover closes it", async () => {
    const { rowOf } = renderOutliner();
    const row = rowOf("dsa");
    fireEvent.click(row.querySelector('button[aria-label="Add category"]')!);
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    // outside-mousedown is immune during the popover's 250ms mount grace
    await new Promise((r) => setTimeout(r, 350));
    fireEvent.mouseDown(document.body);
    await waitFor(() =>
      expect(document.body.querySelector('[role="dialog"]')).toBeNull(),
    );
  });

  it("typing # in a title opens the tag assigner; Enter assigns and strips the fragment", async () => {
    const { editorOf, rowOf } = renderOutliner();
    const editor = editorOf("dsa");
    editor.focus();
    editor.textContent = "dsa #wo";
    setCaret(editor, 7); // end of "#wo"
    fireEvent.input(editor);

    // dropdown opens with Work filtered in
    const listbox = await waitFor(() => {
      const lb = document.body.querySelector('[role="listbox"][aria-label="Assign tag"]');
      expect(lb).not.toBeNull();
      return lb!;
    });
    expect(listbox.textContent).toContain("Work");

    fireEvent.keyDown(editor, { key: "Enter" }); // assign first option

    // title stripped, tag applied
    await waitFor(() => {
      expect(editorOf("dsa").textContent).toBe("dsa");
      expect(
        rowOf("dsa").querySelector('button[aria-label="Edit category (Work)"]'),
      ).not.toBeNull();
    });
  });

  it("# dropdown owns Enter/arrows — the outliner stands down while it's open", async () => {
    const { editorOf, container } = renderOutliner();
    const editor = editorOf("dsa");
    editor.focus();
    editor.textContent = "dsa #";
    setCaret(editor, 5);
    fireEvent.input(editor);
    await waitFor(() =>
      expect(
        document.body.querySelector('[role="listbox"][aria-label="Assign tag"]'),
      ).not.toBeNull(),
    );

    const countBefore = visibleTitles(container).length;
    fireEvent.keyDown(editor, { key: "ArrowDown" }); // must NOT move focus lines
    expect(document.activeElement).toBe(editorOf("dsa"));
    fireEvent.keyDown(editor, { key: "Enter" }); // assigns the tag, must NOT create a goal
    expect(visibleTitles(container)).toHaveLength(countBefore);

    fireEvent.keyDown(editor, { key: "Escape" });
    expect(document.body.querySelector('[aria-label="Assign tag"]')).toBeNull();
  });

  it("a never-titled bullet that only carries a tag is NOT auto-removed on blur", async () => {
    const { getByRole, container } = renderOutliner();
    fireEvent.click(getByRole("button", { name: /new goal/i }));
    const empty = document.activeElement as HTMLElement;
    empty.textContent = "#wo";
    setCaret(empty, 3);
    fireEvent.input(empty);
    await waitFor(() =>
      expect(document.body.querySelector('[aria-label="Assign tag"]')).not.toBeNull(),
    );
    fireEvent.keyDown(empty, { key: "Enter" }); // assign Work, title becomes ""

    fireEvent.blur(empty);
    // bullet survives (tagged), title empty
    await waitFor(() => expect(visibleTitles(container)).toContain(""));
    expect(container.querySelector('[aria-label="Edit category (Work)"]')).not.toBeNull();
  });

  it("category picker sets, suggests, and clears a category", async () => {
    const { container } = renderOutliner();
    const row = container.querySelector('[data-goal-id="dsa"] [data-goal-row]');
    if (!(row instanceof HTMLElement)) throw new Error("no dsa row");

    // open the picker (unset → tag icon button)
    const tagBtn = row.querySelector('button[aria-label="Add category"]');
    if (!(tagBtn instanceof HTMLElement)) throw new Error("no tag button");
    fireEvent.click(tagBtn);

    // type a new category and confirm with Enter
    const input = document.querySelector('input[aria-label="New category"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("no category input");
    fireEvent.change(input, { target: { value: "DSA" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // pill now shows the category
    await waitFor(() => {
      expect(
        row.querySelector('button[aria-label="Edit category (DSA)"]'),
      ).not.toBeNull();
    });

    // reopen → clear works
    fireEvent.click(row.querySelector('button[aria-label="Edit category (DSA)"]')!);
    const clearBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "Clear category",
    );
    if (!clearBtn) throw new Error("no clear button");
    fireEvent.click(clearBtn);
    await waitFor(() => {
      expect(row.querySelector('button[aria-label="Add category"]')).not.toBeNull();
    });
  });

  /* ------------------------- tag management strip ------------------------ */

  it("tags strip lists every tag with its usage count", () => {
    const { getByLabelText } = renderOutliner();
    const chip = getByLabelText("Manage tag Work");
    expect(chip.textContent).toContain("Work");
    expect(chip.textContent).toContain("×1"); // only "work" carries it
  });

  it("delete tag: arm, confirm, bulk-clear via action", async () => {
    const { getByLabelText } = renderOutliner();
    fireEvent.click(getByLabelText("Manage tag Work"));

    const dialog = document.body.querySelector('[role="dialog"][aria-label="Manage tag Work"]');
    expect(dialog).not.toBeNull();

    const deleteBtn = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Delete tag"),
    );
    if (!deleteBtn) throw new Error("no delete button");
    fireEvent.click(deleteBtn); // arms
    const sureBtn = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Sure?"),
    );
    if (!sureBtn) throw new Error("no confirm state");
    fireEvent.click(sureBtn); // confirms

    await waitFor(() => expect(deleteCategorySpy).toHaveBeenCalledWith("Work"));
  });

  it("rename tag: edit the name and hit Enter", async () => {
    const { getByLabelText } = renderOutliner();
    fireEvent.click(getByLabelText("Manage tag Work"));

    const input = document.body.querySelector('input[aria-label="Rename tag"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("no rename input");
    expect(input.value).toBe("Work");
    fireEvent.change(input, { target: { value: "JeGO" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(renameCategorySpy).toHaveBeenCalledWith("Work", "JeGO"));
  });

  it("tags strip is hidden when no tags exist", () => {
    const { queryByText, getByText } = render(
      <GoalTreeProvider initialTree={[]}>
        <OutlinerRoot />
      </GoalTreeProvider>,
    );
    expect(queryByText("Tags")).toBeNull();
    expect(getByText("No goals yet")).toBeTruthy();
  });
});
