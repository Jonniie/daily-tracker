"use client";

import { useEffect, useRef } from "react";
import type { GoalNode } from "@/lib/goals/types";
import { useGoalTreeActions } from "@/components/providers/GoalTreeProvider";

export interface MentionTrigger {
  /** Index in the input value where the triggering `#` sits. */
  start: number;
  query: string;
}

/**
 * Detect an active `#` mention trigger at the caret: a `#` at the start of
 * the input or following whitespace, followed by word chars. Mid-word `#`
 * (e.g. "C#") never triggers.
 */
export function detectMention(value: string, caret: number): MentionTrigger | null {
  const before = value.slice(0, caret);
  const match = /(?:^|\s)#([\w-]*)$/.exec(before);
  if (!match) return null;
  return {
    start: caret - match[0].length + (match[0].startsWith("#") ? 0 : 1),
    query: match[1],
  };
}

/**
 * Keyboard-navigable `#` picker list — presentational. Positioning/portal
 * concerns live in the parent (AnchoredPopover); the input keeps DOM focus
 * throughout (options use mousedown-preventDefault + aria-activedescendant).
 */
export function GoalPickerDropdown({
  results,
  activeIndex,
  onActiveIndex,
  onSelect,
}: {
  results: GoalNode[];
  activeIndex: number;
  onActiveIndex(i: number): void;
  onSelect(goal: GoalNode): void;
}) {
  const { getPathLabel } = useGoalTreeActions();
  const listRef = useRef<HTMLUListElement>(null);

  // Keep the active option visible while arrowing.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${activeIndex}"]`);
    if (el instanceof HTMLElement && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  return (
    <ul
      ref={listRef}
      id="goal-picker"
      role="listbox"
      aria-label="Link a goal"
      className="max-h-64 overflow-y-auto rounded-sub border-2 border-border bg-surface p-1.5 shadow-float"
    >
      {results.length === 0 && (
        <li className="px-2.5 py-2 text-xs text-text-secondary">
          No matching leaf goals
        </li>
      )}
      {results.map((goal, i) => (
        <li
          key={goal.id}
          id={`goal-option-${i}`}
          data-index={i}
          role="option"
          aria-selected={i === activeIndex}
          onMouseDown={(e) => e.preventDefault()} // keep input focused
          onMouseEnter={() => onActiveIndex(i)}
          onClick={() => onSelect(goal)}
          className={`cursor-pointer rounded-none px-2.5 py-1.5 text-sm ${
            i === activeIndex
              ? "bg-primary-subtle text-text-primary"
              : "text-text-secondary"
          }`}
        >
          {getPathLabel(goal.id)}
        </li>
      ))}
    </ul>
  );
}
