"use client";

import { useMemo, useRef, useState } from "react";
import { Tag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useGoalTreeState } from "@/components/providers/GoalTreeProvider";
import { flattenVisible } from "@/lib/goals/tree";
import { deleteCategory, renameCategory } from "@/app/actions/goals";
import {
  AnchoredPopover,
  measureAnchor,
  type AnchorRect,
} from "@/components/ui/AnchoredPopover";

/**
 * Tag management strip on /goals: one chip per tag with its usage count.
 * Click a chip → popover with rename (Enter/Save) and delete (arm-confirm).
 * Both rewrite every goal carrying the tag in one bulk action; the tree
 * resyncs via revalidation. Hidden entirely when no tags exist.
 */
export function TagsManager() {
  const { roots, categories } = useGoalTreeState();
  const [openTag, setOpenTag] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [draft, setDraft] = useState("");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of flattenVisible(roots)) {
      if (f.node.category) map.set(f.node.category, (map.get(f.node.category) ?? 0) + 1);
    }
    return map;
  }, [roots]);

  if (categories.length === 0) return null;

  const openPopover = (tag: string) => {
    setOpenTag(tag);
    setDraft(tag);
    setArmed(false);
    setAnchor(measureAnchor(chipRefs.current.get(tag) ?? null));
  };

  const close = () => setOpenTag(null);

  const doRename = async () => {
    const to = draft.trim();
    if (!openTag || !to || to === openTag || busy) return;
    setBusy(true);
    try {
      const res = await renameCategory(openTag, to);
      if (!res.success) toast.error(res.error);
      else {
        toast.success(`Renamed to “${to}” (${res.data.updated} goal${res.data.updated === 1 ? "" : "s"})`);
        close();
      }
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!openTag || busy) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    try {
      const res = await deleteCategory(openTag);
      if (!res.success) toast.error(res.error);
      else {
        toast.success(`Tag deleted (${res.data.cleared} goal${res.data.cleared === 1 ? "" : "s"} updated)`);
        close();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="g-enter mb-4 flex flex-wrap items-center gap-1.5 rounded-block bg-surface px-3 py-2.5 shadow-block">
      <span className="mr-1 flex items-center gap-1 text-[11px] font-bold tracking-wide text-text-secondary uppercase">
        <Tag size={11} strokeWidth={2.5} />
        Tags
      </span>
      {categories.map((c) => (
        <button
          key={c}
          type="button"
          ref={(el) => {
            if (el) chipRefs.current.set(c, el);
            else chipRefs.current.delete(c);
          }}
          onClick={() => openPopover(c)}
          aria-label={`Manage tag ${c}`}
          className={`rounded-chip px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
            openTag === c
              ? "bg-primary text-primary-foreground"
              : "bg-surface-recessed text-text-secondary hover:text-text-primary"
          }`}
        >
          {c}
          <span className="ml-1 opacity-60 tabular-nums">×{counts.get(c) ?? 0}</span>
        </button>
      ))}

      {openTag && anchor && (
        <AnchoredPopover
          anchor={anchor}
          prefer="below"
          width={224}
          onClose={close}
          role="dialog"
          ariaLabel={`Manage tag ${openTag}`}
          className="flex w-56 flex-col gap-1.5 rounded-sub border-2 border-border bg-surface p-2 shadow-float"
        >
          <input
            type="text"
            value={draft}
            autoFocus
            aria-label="Rename tag"
            className="w-full rounded-sub border-2 border-border bg-surface-recessed px-2 py-1 text-xs outline-none focus:border-primary"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void doRename();
            }}
          />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={busy || !draft.trim() || draft.trim() === openTag}
              onClick={() => void doRename()}
              className="rounded-chip bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground transition-opacity disabled:opacity-40"
            >
              Rename
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void doDelete()}
              className={`ml-auto inline-flex items-center gap-1 rounded-chip border-2 border-border px-2 py-1 text-[11px] font-semibold transition-colors ${
                armed
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface text-text-secondary hover:text-text-primary"
              }`}
            >
              <Trash2 size={11} strokeWidth={2.5} />
              {armed ? "Sure?" : "Delete tag"}
            </button>
          </div>
          <p className="text-[10px] text-text-secondary">
            Delete removes the tag from all goals; goals stay.
          </p>
        </AnchoredPopover>
      )}
    </div>
  );
}
