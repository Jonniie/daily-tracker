"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import type { GoalNode } from "@/lib/goals/types";
import {
  flattenVisible,
  formatPath,
  getPath,
  indexById,
  insertNode,
  isLeaf,
  moveNodeInForest,
  patchNode,
  removeNode,
  setCompletedCascade,
  wouldCreateCycle,
  type MoveTarget,
} from "@/lib/goals/tree";
import { rankSearch } from "@/lib/goals/fuzzy";
import { getCaretOffset } from "@/lib/goals/caret";
import type { ActionResult } from "@/lib/result";
import {
  createGoal,
  deleteGoal,
  moveGoal,
  toggleGoal,
  updateGoalCategory,
  updateGoalTitle,
} from "@/app/actions/goals";

/* ------------------------------------------------------------------ */
/* Context shapes                                                      */
/* ------------------------------------------------------------------ */

export interface FocusRequest {
  id: string;
  caret: number | "start" | "end";
  nonce: number;
}

interface GoalTreeState {
  roots: GoalNode[];
  byId: Map<string, GoalNode>;
  collapsedIds: ReadonlySet<string>;
  /** Distinct non-null categories across the tree (sorted) — picker suggestions. */
  categories: string[];
}

/**
 * Stable mutation callbacks — identities never change (they read the latest
 * tree through refs), so consuming components don't re-render on tree edits.
 */
interface GoalTreeActions {
  /** Optimistically insert a new goal; returns its (temporary) id synchronously. */
  createAt(input: { title: string; parentId: string | null; index: number }): string;
  /** Persist a non-empty title (empty titles are ignored by design — see GoalTitleEditor). */
  updateTitle(id: string, title: string): void;
  toggle(id: string): void;
  remove(id: string): void;
  move(id: string, target: MoveTarget): void;
  /** Set or clear (null) a goal's category, optimistically. */
  setCategory(id: string, category: string | null): void;
  toggleCollapsed(id: string): void;
  requestFocus(id: string, caret: number | "start" | "end"): void;
  /** Breadcrumb label for a goal, read fresh from the latest tree. */
  getPathLabel(id: string): string;
  /** Ancestor titles root→…→goal (for hover cards: joined with " > "). */
  getPathTitles(id: string): string[];
  /** Fuzzy search over incomplete LEAF goals, ranked; labels are breadcrumbs. */
  searchLeafGoals(query: string, limit?: number): GoalNode[];
}

interface GoalFocus {
  focusRequest: FocusRequest | null;
  clearFocusRequest(): void;
}

const StateContext = createContext<GoalTreeState | null>(null);
const ActionsContext = createContext<GoalTreeActions | null>(null);
const FocusContext = createContext<GoalFocus | null>(null);

export function useGoalTreeState(): GoalTreeState {
  const ctx = useContext(StateContext);
  if (!ctx) throw new Error("useGoalTreeState must be used inside GoalTreeProvider");
  return ctx;
}

export function useGoalTreeActions(): GoalTreeActions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error("useGoalTreeActions must be used inside GoalTreeProvider");
  return ctx;
}

export function useGoalFocus(): GoalFocus {
  const ctx = useContext(FocusContext);
  if (!ctx) throw new Error("useGoalFocus must be used inside GoalTreeProvider");
  return ctx;
}

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

interface PendingCreate {
  /** Latest typed title while the create round-trip is in flight. */
  title?: string;
  /** Ops (toggle/move) requested before the real id exists. */
  ops: Array<(realId: string) => void>;
  /** Delete requested before the create resolved — drop everything else. */
  deleted: boolean;
}

export function GoalTreeProvider({
  initialTree,
  children,
}: {
  initialTree: GoalNode[];
  children: ReactNode;
}) {
  const [tree, setTree] = useState<GoalNode[]>(initialTree);
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set());
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  const treeRef = useRef(tree);
  const byIdRef = useRef(indexById(tree));
  const initialRef = useRef(initialTree);
  const pendingRef = useRef(0);
  const deferredSyncRef = useRef(false);
  const aliasRef = useRef(new Map<string, string>()); // temp id → real id
  const pendingCreatesRef = useRef(new Map<string, PendingCreate>());

  // Mirror the latest server tree into a ref (effect: refs aren't touched in render).
  useEffect(() => {
    initialRef.current = initialTree;
  }, [initialTree]);

  const commit = useCallback((next: GoalNode[]) => {
    treeRef.current = next;
    byIdRef.current = indexById(next);
    setTree(next);
  }, []);

  const requestFocus = useCallback((id: string, caret: number | "start" | "end") => {
    setFocusRequest({ id, caret, nonce: Date.now() });
  }, []);

  const clearFocusRequest = useCallback(() => setFocusRequest(null), []);

  /** Replace the client tree with the server's, preserving editor focus across the swap. */
  const applyServerTree = useCallback(
    (serverTree: GoalNode[]) => {
      const active = document.activeElement;
      const editorEl =
        active instanceof HTMLElement ? active.closest("[data-goal-editor]") : null;
      const hostId =
        editorEl?.closest("[data-goal-id]")?.getAttribute("data-goal-id") ?? null;
      const caret = editorEl ? getCaretOffset(editorEl as HTMLElement) : 0;
      commit(serverTree);
      if (hostId) {
        const mapped = aliasRef.current.get(hostId) ?? hostId;
        // Re-focus ONLY when the swap remounted the editor (temp → real id).
        // A surviving editor keeps its DOM node and caret — don't yank it.
        if (mapped !== hostId && byIdRef.current.has(mapped)) {
          requestFocus(mapped, caret);
        }
      }
    },
    [commit, requestFocus],
  );

  // Reconcile when a revalidated RSC payload delivers a new tree. Deferred
  // while optimistic mutations are in flight so they aren't clobbered.
  useEffect(() => {
    if (initialTree === treeRef.current) return;
    if (pendingRef.current > 0) {
      deferredSyncRef.current = true;
      return;
    }
    applyServerTree(initialTree);
  }, [initialTree, applyServerTree]);

  const runOptimistic = useCallback(
    async <T,>(next: GoalNode[], action: () => Promise<ActionResult<T>>) => {
      const snapshot = treeRef.current;
      pendingRef.current++;
      commit(next);
      try {
        const res = await action();
        if (!res.success) {
          commit(snapshot);
          toast.error(res.error);
        }
      } catch {
        commit(snapshot);
        toast.error("Network error — change reverted");
      } finally {
        pendingRef.current--;
        if (pendingRef.current === 0 && deferredSyncRef.current) {
          deferredSyncRef.current = false;
          applyServerTree(initialRef.current);
        }
      }
    },
    [commit, applyServerTree],
  );

  /* ------------------------------ mutations ------------------------------ */

  const createAt = useCallback(
    (input: { title: string; parentId: string | null; index: number }): string => {
      const tempId = `temp-${crypto.randomUUID()}`;
      const now = new Date();
      const node: GoalNode = {
        id: tempId,
        title: input.title,
        parentId: input.parentId,
        isCompleted: false,
        order: input.index,
        category: null,
        createdAt: now,
        updatedAt: now,
        userId: "",
        children: [],
      };
      pendingCreatesRef.current.set(tempId, { ops: [], deleted: false });
      void runOptimistic(
        insertNode(treeRef.current, input.parentId, input.index, node),
        async () => {
          const res = await createGoal(input);
          if (res.success) {
            aliasRef.current.set(tempId, res.data.id);
            const pending = pendingCreatesRef.current.get(tempId);
            pendingCreatesRef.current.delete(tempId);
            if (pending) {
              if (pending.deleted) {
                void deleteGoal(res.data.id);
              } else {
                if (pending.title !== undefined && pending.title !== input.title) {
                  void updateGoalTitle(res.data.id, pending.title);
                }
                for (const op of pending.ops) op(res.data.id);
              }
            }
          } else {
            pendingCreatesRef.current.delete(tempId);
          }
          return res;
        },
      );
      return tempId;
    },
    [runOptimistic],
  );

  const updateTitle = useCallback(
    (id: string, title: string) => {
      const trimmed = title.trim();
      if (trimmed.length === 0) return;
      const next = patchNode(treeRef.current, id, { title: trimmed });
      const realId = aliasRef.current.get(id);
      if (!realId && pendingCreatesRef.current.has(id)) {
        // Create still in flight — queue the title, skip the doomed action call.
        pendingCreatesRef.current.get(id)!.title = trimmed;
        commit(next);
        return;
      }
      void runOptimistic(next, () => updateGoalTitle(realId ?? id, trimmed));
    },
    [commit, runOptimistic],
  );

  const toggle = useCallback(
    (id: string) => {
      const node = byIdRef.current.get(id);
      if (!node) return;
      const next = setCompletedCascade(treeRef.current, id, !node.isCompleted);
      const realId = aliasRef.current.get(id);
      if (!realId && pendingCreatesRef.current.has(id)) {
        pendingCreatesRef.current.get(id)!.ops.push((rid) => void toggleGoal(rid));
        commit(next);
        return;
      }
      void runOptimistic(next, () => toggleGoal(realId ?? id));
    },
    [commit, runOptimistic],
  );

  const remove = useCallback(
    (id: string) => {
      const next = removeNode(treeRef.current, id);
      const realId = aliasRef.current.get(id);
      if (!realId && pendingCreatesRef.current.has(id)) {
        pendingCreatesRef.current.get(id)!.deleted = true;
        commit(next);
        return;
      }
      void runOptimistic(next, () => deleteGoal(realId ?? id));
    },
    [commit, runOptimistic],
  );

  const move = useCallback(
    (id: string, target: MoveTarget) => {
      if (wouldCreateCycle(byIdRef.current, id, target.newParentId)) {
        toast.error("Can't nest a goal under itself or its descendant");
        return;
      }
      const next = moveNodeInForest(
        treeRef.current,
        id,
        target.newParentId,
        target.newIndex,
      );
      const realId = aliasRef.current.get(id);
      if (!realId && pendingCreatesRef.current.has(id)) {
        pendingCreatesRef.current
          .get(id)!
          .ops.push((rid) => void moveGoal({ id: rid, ...target }));
        commit(next);
        return;
      }
      void runOptimistic(next, () => moveGoal({ id: realId ?? id, ...target }));
    },
    [commit, runOptimistic],
  );

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setCategory = useCallback(
    (id: string, category: string | null) => {
      const trimmed = category?.trim() ?? null;
      const value = trimmed === "" ? null : trimmed;
      const next = patchNode(treeRef.current, id, { category: value });
      const realId = aliasRef.current.get(id);
      if (!realId && pendingCreatesRef.current.has(id)) {
        pendingCreatesRef.current
          .get(id)!
          .ops.push((rid) => void updateGoalCategory(rid, value));
        commit(next);
        return;
      }
      void runOptimistic(next, () => updateGoalCategory(realId ?? id, value));
    },
    [commit, runOptimistic],
  );

  /* ---------------------------- read helpers ----------------------------- */

  const getPathLabel = useCallback(
    (id: string) => formatPath(getPath(byIdRef.current, id)),
    [],
  );

  const getPathTitles = useCallback(
    (id: string) =>
      getPath(byIdRef.current, id).map((n) => n.title.trim() || "Untitled"),
    [],
  );

  const searchLeafGoals = useCallback((query: string, limit = 8): GoalNode[] => {
    const flat = flattenVisible(treeRef.current); // search across collapsed branches too
    const entries = flat
      .filter((f) => isLeaf(f.node) && !f.node.isCompleted)
      .map((f) => ({
        item: f.node,
        label: formatPath(getPath(byIdRef.current, f.node.id)),
      }));
    return rankSearch(query, entries, limit);
  }, []);

  /* ------------------------------ contexts ------------------------------- */

  const stateValue = useMemo<GoalTreeState>(() => {
    const categorySet = new Set<string>();
    for (const f of flattenVisible(tree)) {
      if (f.node.category) categorySet.add(f.node.category);
    }
    return {
      roots: tree,
      byId: indexById(tree),
      collapsedIds,
      categories: [...categorySet].sort(),
    };
  }, [tree, collapsedIds]);

  const actionsValue = useMemo<GoalTreeActions>(
    () => ({
      createAt,
      updateTitle,
      toggle,
      remove,
      move,
      setCategory,
      toggleCollapsed,
      requestFocus,
      getPathLabel,
      getPathTitles,
      searchLeafGoals,
    }),
    [
      createAt,
      updateTitle,
      toggle,
      remove,
      move,
      setCategory,
      toggleCollapsed,
      requestFocus,
      getPathLabel,
      getPathTitles,
      searchLeafGoals,
    ],
  );

  const focusValue = useMemo<GoalFocus>(
    () => ({ focusRequest, clearFocusRequest }),
    [focusRequest, clearFocusRequest],
  );

  return (
    <StateContext.Provider value={stateValue}>
      <ActionsContext.Provider value={actionsValue}>
        <FocusContext.Provider value={focusValue}>{children}</FocusContext.Provider>
      </ActionsContext.Provider>
    </StateContext.Provider>
  );
}
