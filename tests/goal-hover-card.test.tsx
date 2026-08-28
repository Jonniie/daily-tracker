import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("@/app/actions/goals", () => ({}));
vi.mock("@/app/actions/planner", () => ({}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import { GoalTreeProvider } from "@/components/providers/GoalTreeProvider";
import { GoalHoverCard } from "@/components/planner/GoalHoverCard";
import { buildTree } from "@/lib/goals/tree";
import type { Goal } from "@/lib/goals/types";

let seq = 0;
function row(id: string, parentId: string | null, order: number): Goal {
  return {
    id,
    title: id,
    parentId,
    isCompleted: false,
    order,
    category: null,
    userId: "u1",
    createdAt: new Date(1_700_000_000_000 + seq++ * 1000),
    updatedAt: new Date(1_700_000_000_000 + seq++ * 1000),
  };
}

// work > ocpp work > weekly ticket
function fixture() {
  return buildTree([
    { ...row("work", null, 0), title: "work" },
    { ...row("ocpp", "work", 0), title: "ocpp work" },
    { ...row("ticket", "ocpp", 0), title: "weekly ticket" },
  ]);
}

function renderChip() {
  return render(
    <GoalTreeProvider initialTree={fixture()}>
      <GoalHoverCard goalId="ticket">
        <span data-testid="chip">#weekly-ticket</span>
      </GoalHoverCard>
    </GoalTreeProvider>,
  );
}

describe("GoalHoverCard (portal tooltip)", () => {
  it("opens after the hover delay, rendered at body level with the full path", async () => {
    const { getByTestId } = renderChip();
    fireEvent.mouseEnter(getByTestId("chip").parentElement!);
    const tip = await waitFor(
      () => {
        const el = document.body.querySelector('[role="tooltip"]');
        expect(el).not.toBeNull();
        return el!;
      },
      { timeout: 800 },
    );
    expect(tip.textContent).toBe("work > ocpp work > weekly ticket");
    // portal: the tooltip is a direct child of body, fixed-positioned
    expect(tip.parentElement).toBe(document.body);
    expect((tip as HTMLElement).style.position).toBe("fixed");
  });

  it("closes on mouse-leave and on scroll", async () => {
    const { getByTestId } = renderChip();
    const trigger = getByTestId("chip").parentElement!;
    fireEvent.mouseEnter(trigger);
    await waitFor(() => expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull());

    fireEvent.mouseLeave(trigger);
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();

    fireEvent.mouseEnter(trigger);
    await waitFor(() => expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull());
    // popover ignores scroll during its 250ms mount grace
    await new Promise((r) => setTimeout(r, 350));
    fireEvent.scroll(window);
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
  });
});
