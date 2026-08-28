"use client";

import { useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import type { GoalNode } from "@/lib/goals/types";
import { useGoalTreeActions } from "@/components/providers/GoalTreeProvider";
import {
  AnchoredPopover,
  measureAnchor,
  type AnchorRect,
} from "@/components/ui/AnchoredPopover";
import { createExtraGoal, sendGoalToBacklog } from "@/app/actions/planner";

/**
 * Extras quick-add: type to fuzzy-search incomplete leaf goals (Enter picks,
 * arrows navigate, Escape closes). No match → "Create '<query>'" makes a new
 * root goal and sends it straight to Extras in one transaction. Every Extra
 * stays goal-backed, so drag-to-calendar and weekly coverage keep working.
 */
export function AddExtraInput({
  onAdded,
}: {
  onAdded: (item: { id: string; goalId: string; title: string }) => void;
}) {
  const { searchLeafGoals, getPathLabel } = useGoalTreeActions();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = query.trim();
  const matches = useMemo(
    () => (trimmed ? searchLeafGoals(trimmed, 6) : []),
    [trimmed, searchLeafGoals],
  );
  const exact = matches.some(
    (g) => g.title.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  const showCreate = trimmed.length > 0 && !exact;
  const optionCount = matches.length + (showCreate ? 1 : 0);

  const openPickerWith = (value: string) => {
    if (!value.trim()) return;
    setAnchor(measureAnchor(inputRef.current));
    setOpen(true);
  };

  const reset = () => {
    setQuery("");
    setOpen(false);
    setActiveIndex(0);
  };

  const pickExisting = async (goal: GoalNode) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await sendGoalToBacklog({ goalId: goal.id });
      if (!res.success) toast.error(res.error);
      else if (res.data.already) toast.info("Already in Extras");
      else {
        onAdded({
          id: `temp-${crypto.randomUUID()}`,
          goalId: goal.id,
          title: goal.title,
        });
        toast.success("Added to Extras");
        reset();
      }
    } finally {
      setBusy(false);
    }
  };

  const createNew = async () => {
    if (busy || !trimmed) return;
    setBusy(true);
    try {
      const res = await createExtraGoal({ title: trimmed });
      if (!res.success) toast.error(res.error);
      else {
        onAdded({
          id: `temp-${crypto.randomUUID()}`,
          goalId: res.data.id,
          title: res.data.title,
        });
        toast.success("Created and added to Extras");
        reset();
      }
    } finally {
      setBusy(false);
    }
  };

  const pickActive = () => {
    if (activeIndex < matches.length) void pickExisting(matches[activeIndex]);
    else if (showCreate) void createNew();
  };

  return (
    <div className="mb-3">
      <input
        ref={inputRef}
        type="text"
        value={query}
        disabled={busy}
        placeholder="Add an extra… (type to search or create)"
        aria-label="Add an extra"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? "extras-picker" : undefined}
        aria-activedescendant={open ? `extra-option-${activeIndex}` : undefined}
        className="w-full rounded-sub border-2 border-border bg-surface-recessed px-3 py-2 text-sm text-text-primary outline-none transition-colors placeholder:text-text-secondary/70 focus:border-primary focus:bg-surface focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
        onChange={(e) => {
          setQuery(e.target.value);
          setActiveIndex(0);
          if (e.target.value.trim()) openPickerWith(e.target.value);
          else setOpen(false);
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, optionCount - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pickActive();
          }
        }}
      />

      {open && anchor && optionCount > 0 && (
        <AnchoredPopover
          anchor={anchor}
          prefer="below"
          matchWidth
          onClose={() => setOpen(false)}
        >
          <ul
            id="extras-picker"
            role="listbox"
            aria-label="Add an extra"
            className="max-h-64 overflow-y-auto rounded-sub border-2 border-border bg-surface p-1.5 shadow-float"
          >
            {matches.map((goal, i) => (
              <li
                key={goal.id}
                id={`extra-option-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => void pickExisting(goal)}
                className={`cursor-pointer rounded-none px-2.5 py-1.5 text-sm ${
                  i === activeIndex
                    ? "bg-primary-subtle text-text-primary"
                    : "text-text-secondary"
                }`}
              >
                {getPathLabel(goal.id)}
              </li>
            ))}
            {showCreate && (
              <li
                id={`extra-option-${matches.length}`}
                role="option"
                aria-selected={activeIndex === matches.length}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(matches.length)}
                onClick={() => void createNew()}
                className={`flex cursor-pointer items-center gap-1.5 rounded-none border-t-2 border-border px-2.5 py-1.5 text-sm font-medium ${
                  activeIndex === matches.length
                    ? "bg-primary-subtle text-primary"
                    : "text-primary"
                }`}
              >
                <Plus size={13} strokeWidth={2.5} />
                Create “{trimmed}”
              </li>
            )}
          </ul>
        </AnchoredPopover>
      )}
    </div>
  );
}
