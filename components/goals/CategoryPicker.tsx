"use client";

import { useRef, useState } from "react";
import { Tag } from "lucide-react";
import {
  useGoalTreeActions,
  useGoalTreeState,
} from "@/components/providers/GoalTreeProvider";
import {
  AnchoredPopover,
  measureAnchor,
  type AnchorRect,
} from "@/components/ui/AnchoredPopover";

/**
 * Category pill/editor for a goal. Set: shows the category as a neutral pill.
 * Unset: a tag icon reveals on row hover. Clicking either opens a popover with
 * existing categories as one-tap chips plus a free-text input (and Clear).
 */
export function CategoryPicker({
  goalId,
  category,
  atRoot,
}: {
  goalId: string;
  category: string | null;
  atRoot: boolean;
}) {
  const { setCategory } = useGoalTreeActions();
  const { categories } = useGoalTreeState();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [draft, setDraft] = useState("");
  const wrapRef = useRef<HTMLSpanElement>(null);

  const apply = (value: string | null) => {
    setCategory(goalId, value);
    setDraft("");
    setOpen(false);
  };

  return (
    <span ref={wrapRef} className="relative ml-1 shrink-0">
      <button
        type="button"
        tabIndex={-1}
        aria-label={category ? `Edit category (${category})` : "Add category"}
        title={category ? `Category: ${category}` : "Add category"}
        onMouseDown={(e) => e.preventDefault()} // don't steal editor focus
        onClick={() => {
          if (!open) setAnchor(measureAnchor(wrapRef.current));
          setOpen((o) => !o);
        }}
        className={`flex items-center rounded-chip text-[11px] font-medium tracking-wide uppercase transition-opacity focus-visible:opacity-100 ${
          category
            ? `px-2 py-0.5 text-text-secondary opacity-100 ${
                atRoot ? "bg-surface-recessed" : "bg-surface"
              }`
            : "h-5 w-5 justify-center text-text-secondary opacity-0 hover:bg-surface-recessed-2 hover:text-text-primary group-hover/item:opacity-100"
          }`}
      >
        {category ? category : <Tag size={11} strokeWidth={2.25} />}
      </button>

      {open && anchor && (
        <AnchoredPopover
          anchor={anchor}
          prefer="below"
          align="end"
          width={192}
          onClose={() => setOpen(false)}
          ignoreRef={wrapRef}
          role="dialog"
          ariaLabel="Set category"
          className="flex w-48 flex-col gap-1.5 rounded-sub border-2 border-border bg-surface p-2 shadow-float"
        >
          {categories.length > 0 && (
            <span className="flex flex-wrap gap-1">
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => apply(c)}
                  className={`rounded-chip px-2 py-0.5 text-[11px] font-medium normal-case transition-colors ${
                    c === category
                      ? "bg-primary text-primary-foreground"
                      : "bg-surface-recessed text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {c}
                </button>
              ))}
            </span>
          )}
          <input
            type="text"
            value={draft}
            autoFocus
            placeholder="New category…"
            aria-label="New category"
            className="w-full rounded-sub border-2 border-border bg-surface-recessed px-2 py-1 text-xs normal-case outline-none placeholder:text-text-secondary/70 focus:border-primary"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) apply(draft.trim());
            }}
          />
          {category && (
            <button
              type="button"
              onClick={() => apply(null)}
              className="self-start text-[11px] font-medium text-text-secondary normal-case hover:text-text-primary"
            >
              Clear category
            </button>
          )}
        </AnchoredPopover>
      )}
    </span>
  );
}
