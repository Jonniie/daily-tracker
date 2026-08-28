"use client";

import { useRef, useState, type ReactNode } from "react";
import { useGoalTreeActions } from "@/components/providers/GoalTreeProvider";
import { AnchoredPopover, measureAnchor, type AnchorRect } from "@/components/ui/AnchoredPopover";

/**
 * Hover card revealing a linked goal's full ancestor path
 * ("jego work > ocpp work > commit last set of changes").
 *
 * Rendered in a body portal (via AnchoredPopover): `absolute` tooltips get
 * clipped by the calendar/backlog/sidebar scroll containers and lose to
 * block-overlay stacking contexts — the portal escapes both. Opens after a
 * 200ms hover/focus delay, closes instantly on leave/blur, and closes on any
 * scroll/resize (its position would otherwise go stale).
 */
export function GoalHoverCard({
  goalId,
  hint,
  children,
}: {
  goalId: string;
  /** Optional dim second line, e.g. "Click the block to edit or remove". */
  hint?: string;
  children: ReactNode;
}) {
  const { getPathTitles } = useGoalTreeActions();
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = () => {
    if (timer.current) clearTimeout(timer.current);
    setAnchor(null);
  };

  const scheduleOpen = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const rect = measureAnchor(triggerRef.current);
      if (rect) setAnchor(rect);
    }, 200);
  };

  const titles = anchor ? getPathTitles(goalId) : null;

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={scheduleOpen}
      onMouseLeave={close}
      onFocus={scheduleOpen}
      onBlur={close}
    >
      {children}
      {anchor && titles && titles.length > 0 && (
        <AnchoredPopover
          anchor={anchor}
          prefer="above"
          width={288}
          onClose={close}
          ignoreRef={triggerRef}
          role="tooltip"
          pointerEventsNone
          className="max-w-72 rounded-sub border-2 border-border bg-surface px-2.5 py-1.5 text-xs whitespace-normal text-text-secondary shadow-float"
        >
          {titles.join(" > ")}
          {hint && (
            <span className="mt-1 block border-t border-border/40 pt-1 text-[10px] opacity-70">
              {hint}
            </span>
          )}
        </AnchoredPopover>
      )}
    </span>
  );
}
