"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { GoalNode } from "@/lib/goals/types";
import { useGoalTreeActions } from "@/components/providers/GoalTreeProvider";
import { linkGoalToTimeBlock, upsertTimeBlockTask } from "@/app/actions/planner";
import { AnchoredPopover, measureAnchor, type AnchorRect } from "@/components/ui/AnchoredPopover";
import { detectMention, GoalPickerDropdown, type MentionTrigger } from "./GoalPickerDropdown";

/**
 * A time block's task input. Typing `#` (at start or after whitespace) opens
 * the goal picker; selecting a goal removes the `#query` fragment from the
 * text and stores a structured Goal-id link (rendered as a chip).
 *
 * Task text autosaves on a 400ms debounce or blur, whichever first.
 */
export function GoalMentionInput({
  date,
  hour,
  initialTask,
  onLinked,
  autoFocus = false,
  onRequestClose,
}: {
  date: string;
  hour: number;
  initialTask: string;
  /** Called after a goal is picked, so the card can render the chip instantly. */
  onLinked?: (goalId: string) => void;
  /** Focus on mount (calendar cell editor). */
  autoFocus?: boolean;
  /** Enter commits + closes; Escape closes (text already autosaved stays). */
  onRequestClose?: () => void;
}) {
  const { searchLeafGoals } = useGoalTreeActions();
  const [value, setValue] = useState(initialTask);
  const [prevInitial, setPrevInitial] = useState(initialTask);
  const [editing, setEditing] = useState(false);
  const [mention, setMention] = useState<MentionTrigger | null>(null);
  const [pickerAnchor, setPickerAnchor] = useState<AnchorRect | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(initialTask);
  const persistedRef = useRef(initialTask);

  // Server revalidation sync — render-phase adjust, never while editing.
  if (initialTask !== prevInitial) {
    setPrevInitial(initialTask);
    if (!editing) setValue(initialTask);
  }
  // Keep refs in step with external syncs (effects: refs aren't touched in render).
  useEffect(() => {
    persistedRef.current = initialTask;
    valueRef.current = initialTask;
  }, [initialTask]);

  // Fuzzy-ranked leaf goals for the open mention query (derived, memoized).
  const results = useMemo(
    () => (mention ? searchLeafGoals(mention.query, 8) : []),
    [mention, searchLeafGoals],
  );

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const persist = (task: string) => {
    if (task === persistedRef.current) return;
    persistedRef.current = task;
    void upsertTimeBlockTask({ date, hour, task }).then((res) => {
      if (!res.success) toast.error(res.error);
    });
  };

  // Flush on unmount: a portalled editor can close (unmount) before blur lands,
  // and a pending debounce would otherwise lose the last few keystrokes.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const v = valueRef.current;
      if (v !== persistedRef.current) {
        persistedRef.current = v;
        void upsertTimeBlockTask({ date, hour, task: v });
      }
    };
  }, [date, hour]);

  const schedulePersist = (task: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => persist(task), 400);
  };

  const closePicker = () => {
    setMention(null);
    setPickerAnchor(null);
  };

  const selectGoal = (goal: GoalNode) => {
    if (!mention) return;
    const caret = inputRef.current?.selectionStart ?? value.length;
    // Strip the "#query" fragment; task text stays pure prose.
    const next = `${value.slice(0, mention.start)}${value.slice(caret)}`
      .replace(/\s{2,}/g, " ")
      .trim();
    setValue(next);
    valueRef.current = next;
    closePicker();
    persist(next);
    onLinked?.(goal.id);
    void linkGoalToTimeBlock({ date, hour, goalId: goal.id }).then((res) => {
      if (!res.success) toast.error(res.error);
    });
    inputRef.current?.focus();
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder="Task… (# links a goal)"
        aria-label={`Task for ${String(hour).padStart(2, "0")}:00`}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={mention !== null}
        aria-controls={mention ? "goal-picker" : undefined}
        aria-activedescendant={
          mention && results.length > 0 ? `goal-option-${activeIndex}` : undefined
        }
        className="w-full rounded-sub border-2 border-border bg-surface-recessed px-3 py-2 text-sm text-text-primary outline-none transition-colors placeholder:text-text-secondary/70 focus:border-primary focus:bg-surface focus:ring-2 focus:ring-primary/40"
        onChange={(e) => {
          setValue(e.target.value);
          valueRef.current = e.target.value;
          schedulePersist(e.target.value);
          const caret = e.target.selectionStart ?? e.target.value.length;
          const trigger = detectMention(e.target.value, caret);
          setMention(trigger);
          // Measure the anchor at open time (event handler — refs are legal here).
          setPickerAnchor(trigger ? measureAnchor(inputRef.current) : null);
          setActiveIndex(0);
        }}
        onKeyDown={(e) => {
          if (mention) {
            if (e.key === "Escape") {
              e.preventDefault();
              closePicker();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIndex((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const goal = results[activeIndex];
              if (goal) selectGoal(goal);
            }
            return;
          }
          // No picker open — editor-level keys (calendar cell mode).
          if (e.key === "Enter" && onRequestClose) {
            e.preventDefault();
            if (debounceRef.current) clearTimeout(debounceRef.current);
            persist(value);
            onRequestClose();
          } else if (e.key === "Escape" && onRequestClose) {
            e.preventDefault();
            if (debounceRef.current) clearTimeout(debounceRef.current);
            onRequestClose();
          }
        }}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false);
          if (debounceRef.current) clearTimeout(debounceRef.current);
          persist(value);
          closePicker();
        }}
      />
      {mention && pickerAnchor && (
        <AnchoredPopover
          anchor={pickerAnchor}
          prefer="below"
          matchWidth
          onClose={closePicker}
          ignoreRef={inputRef}
        >
          <GoalPickerDropdown
            results={results}
            activeIndex={activeIndex}
            onActiveIndex={setActiveIndex}
            onSelect={selectGoal}
          />
        </AnchoredPopover>
      )}
    </div>
  );
}
