"use client";

import { memo } from "react";
import { Check, ChevronRight, GripVertical } from "lucide-react";
import type { GoalNode } from "@/lib/goals/types";
import { subtreeProgress } from "@/lib/goals/tree";
import { useGoalTreeActions, useGoalTreeState } from "@/components/providers/GoalTreeProvider";
import { GoalTitleEditor } from "./GoalTitleEditor";
import { SendToBacklogButton } from "./SendToBacklogButton";
import { DeleteGoalButton } from "./DeleteGoalButton";
import { CategoryPicker } from "./CategoryPicker";

/** Keep editor focus when clicking row chrome (chevron, bullet, actions). */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

/**
 * Recursive outliner item. Memoized on node identity — tree transforms use
 * structural sharing, so an edit only re-renders the affected subtree.
 */
export const GoalItem = memo(
  function GoalItem({
    node,
    depth,
    collapsed,
  }: {
    node: GoalNode;
    depth: number;
    collapsed: boolean;
  }) {
    const { toggle, toggleCollapsed } = useGoalTreeActions();
    const hasChildren = node.children.length > 0;
    const progress = hasChildren ? subtreeProgress(node) : null;

    return (
      <div
        role="treeitem"
        aria-expanded={hasChildren ? !collapsed : undefined}
        aria-level={depth + 1}
        aria-selected={false}
        data-goal-id={node.id}
        className="group/item"
      >
        <div
          data-goal-row
          className={`flex items-center gap-1.5 rounded-sub px-1.5 py-1 transition-colors focus-within:ring-2 focus-within:ring-primary/50 ${
            node.isCompleted ? "bg-success-subtle" : ""
          }`}
        >
          {/* Drag handle — the row itself stays non-draggable so title text
              remains selectable. Drop logic is delegated to OutlinerRoot. */}
          <span
            draggable
            aria-hidden
            onDragStart={(e) => {
              const row = (e.target as HTMLElement).closest("[data-goal-id]");
              const id = row?.getAttribute("data-goal-id");
              if (!id) return;
              e.dataTransfer.setData("application/x-goal-id", id);
              e.dataTransfer.effectAllowed = "move";
              if (row instanceof HTMLElement) {
                e.dataTransfer.setDragImage(row, 12, 12);
                row.classList.add("g-dragging");
              }
            }}
            className="g-drag-handle -ml-1 flex h-4 w-3.5 shrink-0 items-center justify-center text-text-secondary opacity-0 transition-opacity group-hover/item:opacity-100"
          >
            <GripVertical size={12} strokeWidth={2.25} />
          </span>

          {/* Collapse slot — fixed width keeps titles aligned; chevron reveals on hover */}
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
            {hasChildren && (
              <button
                type="button"
                tabIndex={-1}
                aria-label={collapsed ? "Expand sub-goals" : "Collapse sub-goals"}
                onMouseDown={keepFocus}
                onClick={() => toggleCollapsed(node.id)}
                className="text-text-secondary opacity-0 transition-opacity hover:text-text-primary focus-visible:opacity-100 group-hover/item:opacity-100"
              >
                <ChevronRight
                  size={14}
                  strokeWidth={2.25}
                  className={`transition-transform ${collapsed ? "" : "rotate-90"}`}
                />
              </button>
            )}
          </span>

          <button
            type="button"
            role="checkbox"
            aria-checked={node.isCompleted}
            aria-label={node.isCompleted ? `Mark “${node.title}” incomplete` : `Mark “${node.title}” complete`}
            onMouseDown={keepFocus}
            onClick={() => toggle(node.id)}
            className="flex h-[18px] w-[18px] shrink-0 items-center justify-center"
          >
            {node.isCompleted ? (
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-none bg-success text-white">
                <Check size={11} strokeWidth={3.5} />
              </span>
            ) : (
              <span className="h-[18px] w-[18px] rounded-none border-2 border-text-secondary/40 transition-colors group-hover/item:border-text-secondary" />
            )}
          </button>

          <GoalTitleEditor
            id={node.id}
            title={node.title}
            completed={node.isCompleted}
            hasChildren={hasChildren}
            hasCategory={node.category !== null}
          />

          <CategoryPicker goalId={node.id} category={node.category} atRoot={depth === 0} />

          {depth === 0 && progress && progress.total > 0 && (
            <span className="ml-1 shrink-0 rounded-chip bg-surface-recessed px-2 py-0.5 text-[11px] font-medium text-text-secondary">
              {progress.done}/{progress.total} done
            </span>
          )}

          <SendToBacklogButton goalId={node.id} isLeaf={!hasChildren} />
          <DeleteGoalButton goalId={node.id} />
        </div>

        {hasChildren && !collapsed && (
          <div
            role="group"
            className={`mt-1 ml-3 space-y-0.5 rounded-sub p-1.5 sm:ml-3.5 ${
              depth % 2 === 0 ? "bg-surface-recessed" : "bg-surface-recessed-2"
            }`}
          >
            {node.children.map((child) => (
              <GoalItemContainer key={child.id} node={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  },
  (prev, next) =>
    prev.node === next.node && prev.depth === next.depth && prev.collapsed === next.collapsed,
);

/**
 * Reads this node's own collapsed flag from state so `GoalItem` stays
 * memoizable (passing the whole set would invalidate every item on any
 * collapse change).
 */
function GoalItemContainer({ node, depth }: { node: GoalNode; depth: number }) {
  const { collapsedIds } = useGoalTreeState();
  return <GoalItem node={node} depth={depth} collapsed={collapsedIds.has(node.id)} />;
}
