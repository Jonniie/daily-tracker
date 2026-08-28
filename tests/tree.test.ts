import { describe, expect, it } from "vitest";
import {
  buildTree,
  computeDropTarget,
  flattenVisible,
  formatPath,
  getPath,
  indentTarget,
  indexById,
  insertNode,
  isLeaf,
  moveNodeInForest,
  outdentTarget,
  patchNode,
  removeNode,
  setCompletedCascade,
  subtreeProgress,
  wouldCreateCycle,
} from "@/lib/goals/tree";
import type { Goal } from "@/lib/goals/types";

let seq = 0;
function row(id: string, parentId: string | null, order: number, over: Partial<Goal> = {}): Goal {
  return {
    id,
    title: over.title ?? id,
    parentId,
    isCompleted: false,
    order,
    category: null,
    userId: "u1",
    createdAt: new Date(1_700_000_000_000 + seq++ * 1000),
    updatedAt: new Date(1_700_000_000_000 + seq++ * 1000),
    ...over,
  };
}

/**
 * work
 * ├─ ocpp (order 0)
 * │   └─ ticket (order 0)
 * └─ admin (order 1)
 * dsa
 * personal
 */
function fixture() {
  const rows = [
    row("work", null, 2),
    row("dsa", null, 0),
    row("personal", null, 1),
    row("ocpp", "work", 0, { title: "ocpp work" }),
    row("admin", "work", 1),
    row("ticket", "ocpp", 0, { title: "weekly ticket" }),
  ];
  const roots = buildTree(rows);
  return { rows, roots, byId: indexById(roots) };
}

describe("buildTree", () => {
  it("nests children under parents and sorts siblings by order", () => {
    const { roots } = fixture();
    expect(roots.map((r) => r.id)).toEqual(["dsa", "personal", "work"]);
    const work = roots[2];
    expect(work.children.map((c) => c.id)).toEqual(["ocpp", "admin"]);
    expect(work.children[0].children[0].id).toBe("ticket");
  });

  it("surfaces orphans at the root rather than dropping them", () => {
    const roots = buildTree([row("a", null, 0), row("ghost-child", "missing", 0)]);
    expect(roots.map((r) => r.id).sort()).toEqual(["a", "ghost-child"]);
  });

  it("breaks order ties by creation time", () => {
    const roots = buildTree([
      row("later", null, 0, { createdAt: new Date(2000) }),
      row("earlier", null, 0, { createdAt: new Date(1000) }),
    ]);
    expect(roots.map((r) => r.id)).toEqual(["earlier", "later"]);
  });
});

describe("flattenVisible", () => {
  it("flattens depth-first with depth and siblingIndex", () => {
    const { roots } = fixture();
    const flat = flattenVisible(roots);
    expect(flat.map((f) => f.node.id)).toEqual([
      "dsa",
      "personal",
      "work",
      "ocpp",
      "ticket",
      "admin",
    ]);
    expect(flat.find((f) => f.node.id === "ticket")).toMatchObject({
      depth: 2,
      siblingIndex: 0,
    });
    expect(flat.find((f) => f.node.id === "admin")).toMatchObject({
      depth: 1,
      siblingIndex: 1,
    });
  });

  it("skips children of collapsed nodes", () => {
    const { roots } = fixture();
    const flat = flattenVisible(roots, new Set(["work"]));
    expect(flat.map((f) => f.node.id)).toEqual(["dsa", "personal", "work"]);
  });
});

describe("getPath / formatPath", () => {
  it("walks root→leaf and formats the breadcrumb", () => {
    const { byId } = fixture();
    const path = getPath(byId, "ticket");
    expect(path.map((n) => n.id)).toEqual(["work", "ocpp", "ticket"]);
    expect(formatPath(path)).toBe("work > ocpp work — weekly ticket");
  });

  it("returns a bare title for a root with no ancestors", () => {
    const { byId } = fixture();
    expect(formatPath(getPath(byId, "dsa"))).toBe("dsa");
  });

  it("returns empty for an unknown id", () => {
    const { byId } = fixture();
    expect(getPath(byId, "nope")).toEqual([]);
  });
});

describe("subtreeProgress", () => {
  it("counts all descendants, excluding the node itself", () => {
    const rows = [
      row("p", null, 0),
      row("c1", "p", 0, { isCompleted: true }),
      row("c2", "p", 1),
      row("g1", "c2", 0, { isCompleted: true }),
    ];
    const [p] = buildTree(rows);
    expect(subtreeProgress(p)).toEqual({ done: 2, total: 3 });
  });

  it("reports 0/0 for a leaf", () => {
    const [leaf] = buildTree([row("leaf", null, 0)]);
    expect(isLeaf(leaf)).toBe(true);
    expect(subtreeProgress(leaf)).toEqual({ done: 0, total: 0 });
  });
});

describe("wouldCreateCycle", () => {
  it("rejects self-parenting", () => {
    const { byId } = fixture();
    expect(wouldCreateCycle(byId, "work", "work")).toBe(true);
  });

  it("rejects moving under a descendant", () => {
    const { byId } = fixture();
    expect(wouldCreateCycle(byId, "work", "ticket")).toBe(true);
  });

  it("allows moving under a sibling subtree", () => {
    const { byId } = fixture();
    expect(wouldCreateCycle(byId, "dsa", "ocpp")).toBe(false);
  });

  it("allows moving to root", () => {
    const { byId } = fixture();
    expect(wouldCreateCycle(byId, "ticket", null)).toBe(false);
  });
});

describe("indentTarget (Tab)", () => {
  it("no-ops on the first sibling", () => {
    const { roots } = fixture();
    expect(indentTarget(roots, null, 0)).toBeNull();
  });

  it("reparents under the preceding sibling as its last child", () => {
    const { roots, byId } = fixture();
    // "personal" is index 1 at root → moves under "dsa" (which has 0 children)
    expect(indentTarget(roots, null, 1)).toEqual({ newParentId: "dsa", newIndex: 0 });
    // "admin" (index 1 under work) → under "ocpp" which already has 1 child
    const work = byId.get("work")!;
    expect(indentTarget(roots, work, 1)).toEqual({ newParentId: "ocpp", newIndex: 1 });
  });
});

describe("outdentTarget (Shift+Tab)", () => {
  it("no-ops at root level", () => {
    const { roots, byId } = fixture();
    expect(outdentTarget(roots, byId, byId.get("dsa")!)).toBeNull();
  });

  it("positions the node immediately after its former parent", () => {
    const { roots, byId } = fixture();
    // "ticket" outdents to become a child of "work", right after "ocpp" (index 0) → index 1
    expect(outdentTarget(roots, byId, byId.get("ticket")!)).toEqual({
      newParentId: "work",
      newIndex: 1,
    });
  });

  it("outdenting a child of a root lands at root level", () => {
    const { roots, byId } = fixture();
    // "ocpp" outdents to root, right after "work" (root index 2) → index 3
    expect(outdentTarget(roots, byId, byId.get("ocpp")!)).toEqual({
      newParentId: null,
      newIndex: 3,
    });
  });
});

describe("forest transforms (optimistic updates)", () => {
  it("insertNode inserts at a clamped index and reindexes siblings", () => {
    const { roots } = fixture();
    const fresh = { ...row("new", null, 99), children: [] };
    const next = insertNode(roots, null, 1, fresh);
    expect(next.map((r) => r.id)).toEqual(["dsa", "new", "personal", "work"]);
    expect(next.map((r) => r.order)).toEqual([0, 1, 2, 3]);
  });

  it("removeNode drops the whole subtree", () => {
    const { roots } = fixture();
    const next = removeNode(roots, "ocpp");
    const work = next.find((r) => r.id === "work")!;
    expect(work.children.map((c) => c.id)).toEqual(["admin"]);
    expect(indexById(next).has("ticket")).toBe(false);
  });

  it("moveNodeInForest reparents and reindexes both lists", () => {
    const { roots } = fixture();
    const next = moveNodeInForest(roots, "admin", "dsa", 0);
    const byId = indexById(next);
    expect(byId.get("admin")!.parentId).toBe("dsa");
    expect(byId.get("dsa")!.children.map((c) => c.id)).toEqual(["admin"]);
    expect(byId.get("work")!.children.map((c) => c.id)).toEqual(["ocpp"]);
    expect(byId.get("work")!.children[0].order).toBe(0);
  });

  it("moveNodeInForest reorders within the same parent", () => {
    const { roots } = fixture();
    const next = moveNodeInForest(roots, "dsa", null, 2);
    expect(next.map((r) => r.id)).toEqual(["personal", "work", "dsa"]);
    expect(next.map((r) => r.order)).toEqual([0, 1, 2]);
  });

  it("setCompletedCascade(true) completes the subtree only", () => {
    const { roots } = fixture();
    const next = setCompletedCascade(roots, "ocpp", true);
    const byId = indexById(next);
    expect(byId.get("ocpp")!.isCompleted).toBe(true);
    expect(byId.get("ticket")!.isCompleted).toBe(true);
    expect(byId.get("work")!.isCompleted).toBe(false);
  });

  it("setCompletedCascade(false) uncompletes ancestors too", () => {
    const rows = [
      row("p", null, 0, { isCompleted: true }),
      row("c", "p", 0, { isCompleted: true }),
      row("g", "c", 0, { isCompleted: true }),
    ];
    const roots = buildTree(rows);
    const next = setCompletedCascade(roots, "g", false);
    const byId = indexById(next);
    expect(byId.get("g")!.isCompleted).toBe(false);
    expect(byId.get("c")!.isCompleted).toBe(false);
    expect(byId.get("p")!.isCompleted).toBe(false);
  });
});

describe("computeDropTarget (drag-and-drop)", () => {
  it("drops before a root sibling", () => {
    const { roots, byId } = fixture();
    // drag "work" onto "dsa" top → before dsa (index 0)
    expect(computeDropTarget(roots, byId, "work", "dsa", "before")).toEqual({
      newParentId: null,
      newIndex: 0,
    });
  });

  it("drops after a root sibling with removal shift", () => {
    const { roots, byId } = fixture();
    // roots: dsa(0), personal(1), work(2). Drag "dsa" after "personal":
    // raw index 2, minus removal shift → 1 (dsa ends between personal and work)
    expect(computeDropTarget(roots, byId, "dsa", "personal", "after")).toEqual({
      newParentId: null,
      newIndex: 1,
    });
  });

  it("returns null when dropped in place", () => {
    const { roots, byId } = fixture();
    expect(computeDropTarget(roots, byId, "dsa", "personal", "before")).toBeNull();
    expect(computeDropTarget(roots, byId, "personal", "dsa", "after")).toBeNull();
  });

  it("drops into a parent as its last child", () => {
    const { roots, byId } = fixture();
    // drag "dsa" onto "work" middle band → last child after ocpp+admin
    expect(computeDropTarget(roots, byId, "dsa", "work", "into")).toEqual({
      newParentId: "work",
      newIndex: 2,
    });
  });

  it("rejects dropping into/after a cycle", () => {
    const { roots, byId } = fixture();
    expect(computeDropTarget(roots, byId, "work", "ticket", "into")).toBeNull();
    expect(computeDropTarget(roots, byId, "work", "ticket", "after")).toBeNull();
    expect(computeDropTarget(roots, byId, "work", "work", "before")).toBeNull();
  });

  it("drops after a nested sibling (cross-parent move)", () => {
    const { roots, byId } = fixture();
    // drag "dsa" after "ocpp" (under work, index 0) → index 1 under work
    expect(computeDropTarget(roots, byId, "dsa", "ocpp", "after")).toEqual({
      newParentId: "work",
      newIndex: 1,
    });
  });
});

describe("reference preservation (memo-friendly transforms)", () => {
  it("removeNode keeps untouched branches identical by reference", () => {
    const { roots } = fixture();
    const next = removeNode(roots, "ticket");
    expect(next.find((r) => r.id === "dsa")).toBe(roots.find((r) => r.id === "dsa"));
    const work = next.find((r) => r.id === "work")!;
    const oldWork = roots.find((r) => r.id === "work")!;
    expect(work).not.toBe(oldWork); // on the changed path
    expect(work.children.find((c) => c.id === "admin")).toBe(
      oldWork.children.find((c) => c.id === "admin"),
    );
  });

  it("patchNode changes only the patched node", () => {
    const { roots } = fixture();
    const next = patchNode(roots, "dsa", { title: "DSA" });
    expect(next.find((r) => r.id === "dsa")!.title).toBe("DSA");
    expect(next.find((r) => r.id === "work")).toBe(roots.find((r) => r.id === "work"));
  });

  it("setCompletedCascade keeps untouched branches identical by reference", () => {
    const { roots } = fixture();
    const next = setCompletedCascade(roots, "ticket", true);
    expect(next.find((r) => r.id === "dsa")).toBe(roots.find((r) => r.id === "dsa"));
  });

  it("moveNodeInForest keeps untouched branches identical by reference", () => {
    const { roots } = fixture();
    const next = moveNodeInForest(roots, "dsa", null, 0);
    expect(next.find((r) => r.id === "work")).toBe(roots.find((r) => r.id === "work"));
  });
});
