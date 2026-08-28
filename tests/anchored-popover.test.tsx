import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

import { AnchoredPopover } from "@/components/ui/AnchoredPopover";

const rect = { left: 100, right: 300, top: 100, bottom: 140 };

function renderPopover(onClose = vi.fn()) {
  return render(
    <AnchoredPopover anchor={rect} onClose={onClose} role="dialog" ariaLabel="test">
      <button data-testid="inside">inside</button>
    </AnchoredPopover>,
  );
}

describe("AnchoredPopover grace period", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores outside mousedowns within 250ms of opening (rogue same-interaction events)", () => {
    const onClose = vi.fn();
    renderPopover(onClose);

    fireEvent.mouseDown(document.body); // rogue event right after open
    expect(onClose).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    fireEvent.mouseDown(document.body); // genuine outside click later
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores scroll events within the grace window, honours them after", () => {
    const onClose = vi.fn();
    renderPopover(onClose);

    fireEvent.scroll(window);
    expect(onClose).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    fireEvent.scroll(window);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the popover open on clicks inside it (before and after grace)", () => {
    const onClose = vi.fn();
    const { getByTestId } = renderPopover(onClose);

    fireEvent.mouseDown(getByTestId("inside"));
    vi.advanceTimersByTime(300);
    fireEvent.mouseDown(getByTestId("inside"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Escape closes instantly, even during the grace window", () => {
    const onClose = vi.fn();
    renderPopover(onClose);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
