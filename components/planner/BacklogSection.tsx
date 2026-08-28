"use client";

import { useRef, useState } from "react";
import { CornerUpRight, Inbox, X } from "lucide-react";
import { toast } from "sonner";
import type { BacklogItemDTO } from "@/lib/planner";
import { carryOverBacklog, removeBacklogItem } from "@/app/actions/planner";
import {
  useGoalTreeActions,
  useGoalTreeState,
} from "@/components/providers/GoalTreeProvider";
import { GoalHoverCard } from "./GoalHoverCard";
import { AddExtraInput } from "./AddExtraInput";

/** Row model: server DTOs plus optimistic quick-adds carrying their title. */
type ExtraRow = { id: string; goalId: string; title?: string };

/**
 * Inline-editable Extra title. Click the text → input; Enter/blur commits
 * (renames the backing goal everywhere — tree, chips, coverage), Escape
 * cancels. Empty commits revert (titles validate non-empty upstream).
 */
function ExtraTitle({
  goalId,
  title,
  onEditingChange,
}: {
  goalId: string;
  title: string;
  onEditingChange(editing: boolean): void;
}) {
  const { updateTitle } = useGoalTreeActions();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [prevTitle, setPrevTitle] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  // External title change (server sync) — render-phase adjust, never mid-edit.
  if (title !== prevTitle) {
    setPrevTitle(title);
    if (!editing) setDraft(title);
  }

  const commit = () => {
    const next = draft.trim();
    if (next.length > 0 && next !== title) updateTitle(goalId, next);
    setEditing(false);
    onEditingChange(false);
  };
  const cancel = () => {
    setDraft(title);
    setEditing(false);
    onEditingChange(false);
  };

  if (!editing) {
    return (
      <GoalHoverCard goalId={goalId}>
        <button
          type="button"
          title="Click to edit"
          onClick={() => {
            setDraft(title);
            setEditing(true);
            onEditingChange(true);
          }}
          className="cursor-text truncate text-left text-sm font-medium text-text-primary"
        >
          {title}
        </button>
      </GoalHoverCard>
    );
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={draft}
      autoFocus
      aria-label="Edit extra"
      className="min-w-0 flex-1 rounded-sub border-2 border-border bg-surface px-1.5 py-0.5 text-sm font-medium text-text-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/40"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
      onBlur={commit}
    />
  );
}

export interface RolloverInfo {
  fromDate: string;
  toDate: string;
  count: number;
}

/**
 * Extras: leaf goals sent from the outliner. Rows are draggable onto
 * calendar cells (drop = plan it, item leaves the backlog). When yesterday
 * has leftovers, a rollover banner offers a one-click carry-over (a move).
 */
export function BacklogSection({
  items,
  rollover,
}: {
  items: BacklogItemDTO[];
  rollover?: RolloverInfo;
}) {
  const { byId } = useGoalTreeState();
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(new Set());
  const [addedItems, setAddedItems] = useState<ExtraRow[]>([]);
  const [rolloverDismissed, setRolloverDismissed] = useState(false);
  const [carrying, setCarrying] = useState(false);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const visible: ExtraRow[] = [
    ...items.filter((i) => !removedIds.has(i.id)),
    // optimistic quick-adds; dropped once the server list catches up (deduped by goalId)
    ...addedItems.filter(
      (a) => !removedIds.has(a.id) && !items.some((i) => i.goalId === a.goalId),
    ),
  ];

  const titleOf = (item: ExtraRow) =>
    byId.get(item.goalId)?.title ?? item.title ?? "goal";

  const remove = (id: string) => {
    setRemovedIds((prev) => new Set(prev).add(id));
    void removeBacklogItem({ id }).then((res) => {
      if (!res.success) {
        setRemovedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        toast.error(res.error);
      }
    });
  };

  const carryOver = () => {
    if (!rollover || carrying) return;
    setCarrying(true);
    void carryOverBacklog({ fromDate: rollover.fromDate, toDate: rollover.toDate }).then(
      (res) => {
        setCarrying(false);
        if (!res.success) toast.error(res.error);
        else if (res.data.moved === 0) toast.info("Nothing left to carry over");
        else {
          toast.success(
            `Carried over ${res.data.moved} item${res.data.moved === 1 ? "" : "s"}`,
          );
          setRolloverDismissed(true);
        }
      },
    );
  };

  return (
    <section
      className="g-enter mt-4 shrink-0 rounded-block bg-surface p-4 shadow-block sm:p-5"
      style={{ "--stagger": "160ms" } as React.CSSProperties}
    >
      <header className="mb-3 flex items-center gap-2">
        <Inbox size={15} className="text-text-secondary" />
        <h2 className="font-display text-sm font-bold tracking-tight">Extras</h2>
        <span className="rounded-chip bg-surface-recessed px-2 py-0.5 text-[11px] font-medium text-text-secondary">
          {visible.length}
        </span>
        <span className="ml-auto hidden text-[11px] text-text-secondary sm:block">
          drag a row onto a calendar cell to plan it
        </span>
      </header>

      <AddExtraInput onAdded={(item) => setAddedItems((prev) => [...prev, item])} />

      {rollover && rollover.count > 0 && !rolloverDismissed && (
        <div className="mb-3 flex items-center gap-2 rounded-sub border-2 border-border bg-surface-recessed px-2.5 py-1.5">
          <CornerUpRight size={13} className="shrink-0 text-text-secondary" />
          <p className="text-xs text-text-secondary">
            <strong className="text-text-primary">{rollover.count}</strong> item
            {rollover.count === 1 ? "" : "s"} from yesterday
          </p>
          <button
            type="button"
            onClick={carryOver}
            disabled={carrying}
            className="g-btn ml-auto rounded-chip bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground disabled:opacity-60"
          >
            Carry over
          </button>
          <button
            type="button"
            aria-label="Dismiss rollover"
            onClick={() => setRolloverDismissed(true)}
            className="rounded-chip p-0.5 text-text-secondary hover:text-text-primary"
          >
            <X size={13} strokeWidth={2.5} />
          </button>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-text-secondary">
          Nothing here — send leaf goals from the Goals page, or type above.
        </p>
      ) : (
        <ul className="max-h-56 overflow-y-auto">
          {visible.map((item) => (
            <li
              key={item.id}
              draggable={editingRowId !== item.id}
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  "application/x-backlog-item",
                  JSON.stringify({
                    id: item.id,
                    goalId: item.goalId,
                    title: titleOf(item),
                  }),
                );
                e.dataTransfer.effectAllowed = "move";
              }}
              className="group flex cursor-grab items-center gap-2 border-b border-border/40 px-1 py-1.5 last:border-b-0 active:cursor-grabbing"
            >
              <ExtraTitle
                goalId={item.goalId}
                title={titleOf(item)}
                onEditingChange={(editing) => setEditingRowId(editing ? item.id : null)}
              />
              <button
                type="button"
                aria-label="Remove from Extras"
                onClick={() => remove(item.id)}
                className="ml-auto shrink-0 rounded-chip p-0.5 text-text-secondary opacity-0 transition-opacity group-hover:opacity-100 hover:text-text-primary focus-visible:opacity-100"
              >
                <X size={13} strokeWidth={2.5} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
