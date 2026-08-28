"use client";

import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  useGoalTreeActions,
  useGoalTreeState,
} from "@/components/providers/GoalTreeProvider";
import { flattenVisible } from "@/lib/goals/tree";

/**
 * Delete a goal (subtree included). Two-step: first click arms the button
 * ("Sure?"), second click deletes — no modal. Optimistic via the provider;
 * focus lands on the previous visible line, mirroring Backspace behavior.
 */
export function DeleteGoalButton({ goalId }: { goalId: string }) {
  const { remove, requestFocus } = useGoalTreeActions();
  const { roots, collapsedIds } = useGoalTreeState();
  const [armed, setArmed] = useState(false);
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const disarmSoon = () => {
    if (disarmTimer.current) clearTimeout(disarmTimer.current);
    disarmTimer.current = setTimeout(() => setArmed(false), 2500);
  };

  const onClick = () => {
    if (!armed) {
      setArmed(true);
      disarmSoon();
      return;
    }
    if (disarmTimer.current) clearTimeout(disarmTimer.current);
    setArmed(false);

    const flat = flattenVisible(roots, collapsedIds);
    const idx = flat.findIndex((f) => f.node.id === goalId);
    const prev = idx > 0 ? flat[idx - 1] : null;
    const next = flat[idx + 1] ?? null;
    remove(goalId);
    toast.success("Goal deleted");
    if (prev) requestFocus(prev.node.id, "end");
    else if (next) requestFocus(next.node.id, "start");
  };

  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={armed ? "Click again to confirm delete" : "Delete goal"}
      title={armed ? "Click again to confirm" : "Delete goal (subtasks included)"}
      onMouseDown={(e) => e.preventDefault()} // don't steal editor focus
      onClick={onClick}
      onBlur={() => setArmed(false)}
      className={`ml-0.5 flex h-5 shrink-0 items-center justify-center gap-0.5 rounded-chip px-0.5 text-[10px] font-semibold transition-all focus-visible:opacity-100 ${
        armed
          ? "bg-primary text-primary-foreground opacity-100"
          : "w-5 text-text-secondary opacity-0 hover:bg-surface-recessed-2 hover:text-text-primary group-hover/item:opacity-100"
      }`}
    >
      {armed ? "Sure?" : <Trash2 size={12} strokeWidth={2.25} />}
    </button>
  );
}
