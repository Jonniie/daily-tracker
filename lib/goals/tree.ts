import type { Goal, GoalNode } from "./types";

const NO_COLLAPSED: ReadonlySet<string> = new Set();

/** Index every node in a forest by id. */
export function indexById(roots: GoalNode[]): Map<string, GoalNode> {
  const map = new Map<string, GoalNode>();
  const walk = (nodes: GoalNode[]) => {
    for (const node of nodes) {
      map.set(node.id, node);
      walk(node.children);
    }
  };
  walk(roots);
  return map;
}

/**
 * Nest a flat row list into a forest. Siblings are sorted by `order`
 * (ties broken by creation time for stability). Rows whose parent is
 * missing (orphans) surface at the root rather than disappearing.
 */
export function buildTree(rows: Goal[]): GoalNode[] {
  const nodes = new Map<string, GoalNode>();
  for (const row of rows) nodes.set(row.id, { ...row, children: [] });

  const roots: GoalNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortRecursive = (list: GoalNode[]) => {
    list.sort(
      (a, b) => a.order - b.order || a.createdAt.getTime() - b.createdAt.getTime(),
    );
    for (const node of list) sortRecursive(node.children);
  };
  sortRecursive(roots);
  return roots;
}

export interface FlatItem {
  node: GoalNode;
  depth: number;
  parent: GoalNode | null;
  /** Index within its own sibling list (roots share one list). */
  siblingIndex: number;
}

/**
 * Depth-first flatten of the *visible* tree: children of collapsed nodes
 * are skipped. This is the list keyboard navigation (arrows, Backspace
 * focus handoff) operates on.
 */
export function flattenVisible(
  roots: GoalNode[],
  collapsed: ReadonlySet<string> = NO_COLLAPSED,
): FlatItem[] {
  const out: FlatItem[] = [];
  const walk = (nodes: GoalNode[], depth: number, parent: GoalNode | null) => {
    nodes.forEach((node, siblingIndex) => {
      out.push({ node, depth, parent, siblingIndex });
      if (!collapsed.has(node.id)) walk(node.children, depth + 1, node);
    });
  };
  walk(roots, 0, null);
  return out;
}

/** Ancestor path from the root down to and including the node itself. */
export function getPath(
  byId: ReadonlyMap<string, GoalNode>,
  id: string,
): GoalNode[] {
  const path: GoalNode[] = [];
  let current = byId.get(id);
  let guard = 0;
  while (current && guard++ < 1000) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

/** Breadcrumb display string, e.g. "work > ocpp work — weekly ticket". */
export function formatPath(path: GoalNode[]): string {
  if (path.length === 0) return "";
  const crumbs = path.map((n) => n.title.trim() || "Untitled");
  if (crumbs.length === 1) return crumbs[0];
  return `${crumbs.slice(0, -1).join(" > ")} — ${crumbs[crumbs.length - 1]}`;
}

/** Completion counts over all descendants (excludes the node itself). */
export function subtreeProgress(node: GoalNode): { done: number; total: number } {
  let done = 0;
  let total = 0;
  const walk = (n: GoalNode) => {
    for (const child of n.children) {
      total++;
      if (child.isCompleted) done++;
      walk(child);
    }
  };
  walk(node);
  return { done, total };
}

/** True when `newParentId` is `id` itself or one of its descendants. */
export function wouldCreateCycle(
  byId: ReadonlyMap<string, GoalNode>,
  id: string,
  newParentId: string | null,
): boolean {
  let current = newParentId ? byId.get(newParentId) : undefined;
  let guard = 0;
  while (current && guard++ < 1000) {
    if (current.id === id) return true;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return false;
}

export interface MoveTarget {
  newParentId: string | null;
  newIndex: number;
}

/** Where a dragged row lands relative to the row under the cursor. */
export type DropZone = "before" | "after" | "into";

/**
 * Resolve a drag-and-drop gesture to a `MoveTarget` for `moveGoal`
 * (null = no-op / rejected). Index math accounts for the removal shift
 * when reordering within the same sibling list. `into` drops as the
 * target's last child. Cycles are rejected via `wouldCreateCycle`.
 */
export function computeDropTarget(
  roots: GoalNode[],
  byId: ReadonlyMap<string, GoalNode>,
  draggedId: string,
  targetId: string,
  zone: DropZone,
): MoveTarget | null {
  if (draggedId === targetId) return null;
  const dragged = byId.get(draggedId);
  const target = byId.get(targetId);
  if (!dragged || !target) return null;

  if (zone === "into") {
    if (wouldCreateCycle(byId, draggedId, targetId)) return null;
    return { newParentId: targetId, newIndex: target.children.length };
  }

  const newParentId = target.parentId ?? null;
  if (wouldCreateCycle(byId, draggedId, newParentId)) return null;

  const parent = newParentId ? byId.get(newParentId) : undefined;
  const siblings = parent ? parent.children : roots;
  const targetIdx = siblings.findIndex((s) => s.id === targetId);
  if (targetIdx === -1) return null;

  let index = zone === "after" ? targetIdx + 1 : targetIdx;
  if ((dragged.parentId ?? null) === newParentId) {
    const draggedIdx = siblings.findIndex((s) => s.id === draggedId);
    if (draggedIdx !== -1 && draggedIdx < index) index -= 1;
    if (draggedIdx === index) return null; // dropped in place
  }
  return { newParentId, newIndex: index };
}

/**
 * Tab (indent): reparent under the immediately preceding sibling, becoming
 * its last child. Null when there is no preceding sibling (no-op).
 */
export function indentTarget(
  roots: GoalNode[],
  parent: GoalNode | null,
  siblingIndex: number,
): MoveTarget | null {
  const siblings = parent ? parent.children : roots;
  if (siblingIndex <= 0) return null;
  const preceding = siblings[siblingIndex - 1];
  return { newParentId: preceding.id, newIndex: preceding.children.length };
}

/**
 * Shift+Tab (outdent): become a sibling of the current parent, positioned
 * immediately after it. Null at root level (no-op).
 */
export function outdentTarget(
  roots: GoalNode[],
  byId: ReadonlyMap<string, GoalNode>,
  node: GoalNode,
): MoveTarget | null {
  if (!node.parentId) return null;
  const parent = byId.get(node.parentId);
  if (!parent) return null;
  const grandparent = parent.parentId ? byId.get(parent.parentId) : undefined;
  const parentSiblings = grandparent ? grandparent.children : roots;
  const parentIndex = parentSiblings.findIndex((s) => s.id === parent.id);
  if (parentIndex === -1) return null;
  return { newParentId: parent.parentId ?? null, newIndex: parentIndex + 1 };
}

/** A leaf goal has no children — the unit linkable from time blocks / backlog. */
export function isLeaf(node: GoalNode): boolean {
  return node.children.length === 0;
}

/* ------------------------------------------------------------------ */
/* Pure forest transforms (used for optimistic updates client-side).   */
/* Inputs are never mutated, and untouched subtrees keep their exact   */
/* object references so memoized components skip unchanged branches.   */
/* ------------------------------------------------------------------ */

/** Map a sibling list, returning the SAME array reference when nothing changed. */
function mapPreserved(
  nodes: GoalNode[],
  fn: (n: GoalNode) => GoalNode,
): GoalNode[] {
  let changed = false;
  const out = nodes.map((n) => {
    const r = fn(n);
    if (r !== n) changed = true;
    return r;
  });
  return changed ? out : nodes;
}

/** Reindex sibling orders; preserves references when already sequential. */
function reindex(siblings: GoalNode[]): GoalNode[] {
  let changed = false;
  const out = siblings.map((n, i) => {
    if (n.order !== i) {
      changed = true;
      return { ...n, order: i };
    }
    return n;
  });
  return changed ? out : siblings;
}

/** Patch one node by id; untouched branches keep their references. */
export function patchNode(
  roots: GoalNode[],
  id: string,
  patch: Partial<GoalNode>,
): GoalNode[] {
  return mapPreserved(roots, (n) => {
    if (n.id === id) return { ...n, ...patch };
    const kids = patchNode(n.children, id, patch);
    return kids === n.children ? n : { ...n, children: kids };
  });
}

/** Insert `node` into the sibling list of `parentId` (null = root) at a clamped index. */
export function insertNode(
  roots: GoalNode[],
  parentId: string | null,
  index: number,
  node: GoalNode,
): GoalNode[] {
  if (parentId === null) {
    const next = [...roots];
    next.splice(Math.max(0, Math.min(index, next.length)), 0, node);
    return reindex(next);
  }
  return mapPreserved(roots, (n) => {
    if (n.id === parentId) {
      const children = [...n.children];
      children.splice(Math.max(0, Math.min(index, children.length)), 0, node);
      return { ...n, children: reindex(children) };
    }
    const kids = insertNode(n.children, parentId, index, node);
    return kids === n.children ? n : { ...n, children: kids };
  });
}

/** Remove the node (and its subtree) with the given id. */
export function removeNode(roots: GoalNode[], id: string): GoalNode[] {
  let changed = false;
  const out: GoalNode[] = [];
  for (const n of roots) {
    if (n.id === id) {
      changed = true;
      continue;
    }
    const kids = removeNode(n.children, id);
    if (kids !== n.children) {
      changed = true;
      out.push({ ...n, children: kids });
    } else {
      out.push(n);
    }
  }
  return changed ? out : roots;
}

/**
 * Move a node to a new parent/index, reindexing both sibling lists.
 * Mirrors the server-side `moveGoal` semantics for optimistic updates.
 * Assumes the caller already rejected cycles (`wouldCreateCycle`).
 */
export function moveNodeInForest(
  roots: GoalNode[],
  id: string,
  newParentId: string | null,
  newIndex: number,
): GoalNode[] {
  const byId = indexById(roots);
  const moving = byId.get(id);
  if (!moving) return roots;
  if (moving.parentId === newParentId) {
    // Same list: remove then reinsert at clamped index.
    const without = removeNode(roots, id);
    return insertNode(without, newParentId, newIndex, {
      ...moving,
      parentId: newParentId,
    });
  }
  const detached = removeNode(roots, id);
  const resequenced = reindexSiblingsOf(detached, moving.parentId);
  return insertNode(resequenced, newParentId, newIndex, {
    ...moving,
    parentId: newParentId,
  });
}

function reindexSiblingsOf(roots: GoalNode[], parentId: string | null): GoalNode[] {
  if (parentId === null) return reindex(roots);
  return mapPreserved(roots, (n) => {
    if (n.id === parentId) return { ...n, children: reindex(n.children) };
    const kids = reindexSiblingsOf(n.children, parentId);
    return kids === n.children ? n : { ...n, children: kids };
  });
}

/**
 * Mirror of the server cascade: completing a goal completes its subtree;
 * uncompleting a goal also uncompletes its ancestors.
 */
export function setCompletedCascade(
  roots: GoalNode[],
  id: string,
  completed: boolean,
): GoalNode[] {
  if (completed) {
    const completeIn = (nodes: GoalNode[]): GoalNode[] =>
      mapPreserved(nodes, (n) => {
        if (n.id === id) return markSubtree(n);
        const kids = completeIn(n.children);
        return kids === n.children ? n : { ...n, children: kids };
      });
    return completeIn(roots);
  }
  const byId = indexById(roots);
  const affected = new Set<string>([id]);
  let current = byId.get(id);
  let guard = 0;
  while (current?.parentId && guard++ < 1000) {
    affected.add(current.parentId);
    current = byId.get(current.parentId);
  }
  const uncompleteIn = (nodes: GoalNode[]): GoalNode[] =>
    mapPreserved(nodes, (n) => {
      const kids = uncompleteIn(n.children);
      const self = affected.has(n.id) ? { ...n, isCompleted: false } : n;
      if (kids !== n.children) return { ...self, children: kids };
      return self;
    });
  return uncompleteIn(roots);
}

function markSubtree(node: GoalNode): GoalNode {
  return { ...node, isCompleted: true, children: node.children.map(markSubtree) };
}
