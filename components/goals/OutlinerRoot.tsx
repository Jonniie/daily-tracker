"use client";

import { useRef } from "react";
import { Plus } from "lucide-react";
import {
  useGoalTreeActions,
  useGoalTreeState,
} from "@/components/providers/GoalTreeProvider";
import { computeDropTarget, type DropZone } from "@/lib/goals/tree";
import { setCaret } from "@/lib/goals/caret";
import { GoalItem } from "./GoalItem";
import { TagsManager } from "./TagsManager";
import { useOutlinerKeyboard } from "./useOutlinerKeyboard";

const GOAL_MIME = "application/x-goal-id";
const ZONE_CLASSES = ["g-drop-before", "g-drop-after", "g-drop-into"] as const;

/** Top 30% = before, bottom 30% = after, middle band = drop into (as last child). */
function zoneFromY(row: Element, clientY: number): DropZone {
  const rect = row.getBoundingClientRect();
  const y = (clientY - rect.top) / rect.height;
  if (y < 0.3) return "before";
  if (y > 0.7) return "after";
  return "into";
}

/**
 * The /goals outliner: each root goal is its own block card; nested children
 * render as recessed sub-blocks inside it. Keyboard interaction is delegated
 * to `useOutlinerKeyboard`; drag-and-drop is delegated to the handlers here
 * (indicators are classList-toggled — no React state churn while dragging).
 */
export function OutlinerRoot() {
  const { roots, byId, collapsedIds } = useGoalTreeState();
  const { createAt, requestFocus, move } = useGoalTreeActions();
  const containerRef = useRef<HTMLDivElement>(null);

  useOutlinerKeyboard(containerRef);

  const addRootGoal = () => {
    const tempId = createAt({ title: "", parentId: null, index: roots.length });
    requestFocus(tempId, "start");
  };

  const clearIndicators = (container: HTMLElement) => {
    container
      .querySelectorAll("[data-goal-row]")
      .forEach((el) => el.classList.remove(...ZONE_CLASSES));
    container
      .querySelectorAll(".g-dragging")
      .forEach((el) => el.classList.remove("g-dragging"));
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(GOAL_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const container = e.currentTarget;
    container
      .querySelectorAll("[data-goal-row]")
      .forEach((el) => el.classList.remove(...ZONE_CLASSES));
    const row = (e.target as HTMLElement).closest("[data-goal-row]");
    if (!row) return;
    row.classList.add(
      zoneFromY(row, e.clientY) === "before"
        ? "g-drop-before"
        : zoneFromY(row, e.clientY) === "after"
          ? "g-drop-after"
          : "g-drop-into",
    );
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(GOAL_MIME)) return;
    e.preventDefault();
    clearIndicators(e.currentTarget);
    const draggedId = e.dataTransfer.getData(GOAL_MIME);
    const row = (e.target as HTMLElement).closest("[data-goal-row]");
    // data-goal-id lives on the treeitem wrapper, one level up from the row
    const targetId = row?.closest("[data-goal-id]")?.getAttribute("data-goal-id") ?? null;
    if (!draggedId || !targetId || !row) return;
    const target = computeDropTarget(roots, byId, draggedId, targetId, zoneFromY(row, e.clientY));
    if (target) move(draggedId, target);
  };

  /**
   * Clicking anywhere on a row's non-interactive area (padding, gaps) focuses
   * its title editor with the caret at the end — keys must never feel dead.
   * Buttons, links, the drag handle, and the editor itself keep their defaults.
   */
  const onTreeClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, a, [data-goal-editor], [draggable="true"]')) return;
    const row = target.closest("[data-goal-row]");
    const editor = row?.querySelector("[data-goal-editor]");
    if (editor instanceof HTMLElement) {
      editor.focus();
      setCaret(editor, editor.textContent?.length ?? 0);
    }
  };

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="page-title g-enter">Goals</h1>
        <button
          type="button"
          onClick={addRootGoal}
          className="g-btn g-enter inline-flex items-center gap-1.5 rounded-chip bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          style={{ "--stagger": "60ms" } as React.CSSProperties}
        >
          <Plus size={15} strokeWidth={2.5} />
          New goal
        </button>
      </div>

      <TagsManager />

      <div
        ref={containerRef}
        role="tree"
        aria-label="Goals outliner"
        className="space-y-3.5"
        onClick={onTreeClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={(e) => clearIndicators(e.currentTarget)}
      >
        {roots.map((node, i) => (
          <section
            key={node.id}
            className="g-enter g-block rounded-block bg-surface p-3.5 shadow-block sm:p-4"
            style={{ "--stagger": `${Math.min(i, 8) * 45}ms` } as React.CSSProperties}
          >
            <GoalItem node={node} depth={0} collapsed={collapsedIds.has(node.id)} />
          </section>
        ))}

        {roots.length === 0 && (
          <div className="rounded-block bg-surface p-6 text-center shadow-block">
            <p className="font-display text-base font-semibold">No goals yet</p>
            <p className="mt-1 text-sm text-text-secondary">
              Click <strong>New goal</strong> and type — Enter adds the next one, Tab nests,
              Shift+Tab unnests.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
