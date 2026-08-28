"use client";

import { useEffect, type RefObject } from "react";
import { toast } from "sonner";
import {
  useGoalTreeActions,
  useGoalTreeState,
} from "@/components/providers/GoalTreeProvider";
import {
  flattenVisible,
  indentTarget,
  outdentTarget,
  type FlatItem,
} from "@/lib/goals/tree";
import { getCaretOffset } from "@/lib/goals/caret";

/**
 * Single delegated keydown handler for the whole outliner. Keys are only
 * intercepted when the event originates inside a goal title editor
 * (`[data-goal-editor]`); everything else (buttons, links) keeps defaults.
 *
 *   Enter              → split at caret / insert sibling below, focus it
 *                        (on an empty line: close the entry instead)
 *   Tab / Shift+Tab    → indent under preceding sibling / outdent after parent
 *   Backspace (empty)  → delete, focus end of previous visible line
 *   Cmd/Ctrl+Backspace → force-delete the line (non-empty, children included)
 *   Cmd/Ctrl+Enter     → toggle complete
 *   ArrowUp / Down     → move focus through the flattened *visible* list
 */
export function useOutlinerKeyboard(containerRef: RefObject<HTMLElement | null>) {
  const { roots, byId, collapsedIds } = useGoalTreeState();
  const { createAt, updateTitle, remove, move, toggle, requestFocus } =
    useGoalTreeActions();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return; // never fight IME composition

      const target = e.target as HTMLElement | null;
      const editor = target?.closest?.("[data-goal-editor]");
      if (!(editor instanceof HTMLElement)) return;
      // While the editor's own `#` category dropdown is open, IT owns
      // Enter/Tab/arrows/Escape — the outliner keys must stand down.
      if (editor.hasAttribute("data-tag-open")) return;
      const hostId = editor.closest("[data-goal-id]")?.getAttribute("data-goal-id");
      if (!hostId) return;

      const flat = flattenVisible(roots, collapsedIds);
      const idx = flat.findIndex((f) => f.node.id === hostId);
      if (idx === -1) return;
      const item = flat[idx];

      switch (e.key) {
        case "Enter": {
          if (e.metaKey || e.ctrlKey) {
            // Cmd/Ctrl+Enter: toggle complete from the keyboard.
            e.preventDefault();
            toggle(item.node.id);
            return;
          }
          if (e.shiftKey) return;
          e.preventDefault();
          handleEnter(item, editor, flat, idx);
          return;
        }
        case "Tab": {
          e.preventDefault();
          handleTab(item, editor, e.shiftKey);
          return;
        }
        case "Backspace": {
          if (e.metaKey || e.ctrlKey) {
            // Cmd/Ctrl+Backspace: force-delete the whole line — non-empty and
            // children included. The chord is deliberate; plain Backspace
            // keeps the safe empty-only behavior with the children guard.
            e.preventDefault();
            const prev = flat[idx - 1] ?? null;
            const next = flat[idx + 1] ?? null;
            remove(item.node.id);
            if (prev) requestFocus(prev.node.id, "end");
            else if (next) requestFocus(next.node.id, "start");
            return;
          }
          handleBackspace(e, item, editor, flat, idx);
          return;
        }
        case "ArrowUp": {
          e.preventDefault();
          focusNeighbor(flat, idx - 1, editor);
          return;
        }
        case "ArrowDown": {
          e.preventDefault();
          focusNeighbor(flat, idx + 1, editor);
          return;
        }
      }
    };

    const handleEnter = (
      item: FlatItem,
      editor: HTMLElement,
      flat: FlatItem[],
      idx: number,
    ) => {
      const title = editor.textContent ?? "";

      // Enter on an EMPTY bullet closes the entry instead of chaining endless
      // empty rows (Obsidian-style). Parents keep their empty row — deleting
      // would strand children; Backspace surfaces the same guard.
      if (title.trim().length === 0) {
        if (item.node.children.length > 0) return;
        const prev = flat[idx - 1] ?? null;
        const next = flat[idx + 1] ?? null;
        remove(item.node.id);
        if (prev) requestFocus(prev.node.id, "end");
        else if (next) requestFocus(next.node.id, "start");
        return;
      }

      const caret = getCaretOffset(editor);
      const parentId = item.parent?.id ?? null;

      // Caret at position 0: keep the text where it is, open an empty row below.
      if (caret === 0) {
        const tempId = createAt({ title: "", parentId, index: item.siblingIndex + 1 });
        requestFocus(tempId, "start");
        return;
      }

      // Split at the caret; trim the seam so neither half keeps stray spaces.
      const left = title.slice(0, caret).trimEnd();
      const right = title.slice(caret).trimStart();

      const tempId = createAt({ title: right, parentId, index: item.siblingIndex + 1 });
      if (left !== title) {
        editor.textContent = left; // DOM is source of truth while focused
        updateTitle(item.node.id, left);
      }
      requestFocus(tempId, "start");
    };

    const handleTab = (item: FlatItem, editor: HTMLElement, outdent: boolean) => {
      const target = outdent
        ? outdentTarget(roots, byId, item.node)
        : indentTarget(roots, item.parent, item.siblingIndex);
      if (!target) return; // no-op: first sibling (Tab) or root level (Shift+Tab)
      const caret = getCaretOffset(editor);
      move(item.node.id, target);
      // Reparenting remounts the editor — re-focus at the same caret.
      requestFocus(item.node.id, caret);
    };

    const handleBackspace = (
      e: KeyboardEvent,
      item: FlatItem,
      editor: HTMLElement,
      flat: FlatItem[],
      idx: number,
    ) => {
      const title = editor.textContent ?? "";
      if (title.length > 0) return; // ordinary text deletion
      e.preventDefault();
      // Chosen behavior: never delete an item that still has children.
      if (item.node.children.length > 0) {
        toast.info("Outdent or delete its sub-goals first");
        return;
      }
      const prev = flat[idx - 1] ?? null;
      const next = flat[idx + 1] ?? null;
      remove(item.node.id);
      if (prev) requestFocus(prev.node.id, "end");
      else if (next) requestFocus(next.node.id, "start");
    };

    const focusNeighbor = (flat: FlatItem[], targetIdx: number, editor: HTMLElement) => {
      const target = flat[targetIdx];
      if (!target) return;
      requestFocus(target.node.id, getCaretOffset(editor));
    };

    container.addEventListener("keydown", onKeyDown);
    return () => container.removeEventListener("keydown", onKeyDown);
  }, [containerRef, roots, byId, collapsedIds, createAt, updateTitle, remove, move, toggle, requestFocus]);
}
