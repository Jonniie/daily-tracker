"use client";

import { X } from "lucide-react";
import { useGoalTreeState } from "@/components/providers/GoalTreeProvider";
import { GoalHoverCard } from "./GoalHoverCard";

function slugify(title: string): string {
  const s = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "goal";
}

/**
 * The indigo `#goal-slug` pill rendered inside a time block (or backlog row).
 * Stores/displays by Goal.id — the slug is derived from the live tree.
 */
export function GoalChip({
  goalId,
  onRemove,
}: {
  goalId: string;
  onRemove?: () => void;
}) {
  const { byId } = useGoalTreeState();
  const goal = byId.get(goalId);
  const label = slugify(goal?.title ?? "goal");

  return (
    <GoalHoverCard goalId={goalId}>
      <span className="inline-flex items-center gap-0.5 rounded-chip bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
        #{label}
        {onRemove && (
          <button
            type="button"
            aria-label={`Unlink ${label}`}
            onClick={onRemove}
            className="ml-0.5 rounded-chip opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100"
          >
            <X size={11} strokeWidth={3} />
          </button>
        )}
      </span>
    </GoalHoverCard>
  );
}
