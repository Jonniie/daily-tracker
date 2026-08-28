"use server";

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { ok, err, type ActionResult } from "@/lib/result";
import { todayKey } from "@/lib/date-key";
import { ledgerGoalCompleted } from "@/lib/ledger";
import type { Goal } from "@/lib/goals/types";

type TxClient = Prisma.TransactionClient;

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

function revalidateGoalPaths() {
  revalidatePath("/goals");
  revalidatePath("/today");
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Unexpected error";
}

const titleSchema = z.string().trim().min(1, "Title cannot be empty").max(500);
const categorySchema = z.string().trim().max(50).nullish();

/** All descendant ids (inclusive of `id`) via recursive CTE, scoped to the owner. */
async function subtreeIds(
  tx: TxClient,
  id: string,
  userId: string,
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE subtree(id) AS (
      SELECT id FROM "Goal" WHERE id = ${id} AND "userId" = ${userId}
      UNION ALL
      SELECT g.id FROM "Goal" g
      JOIN subtree s ON g."parentId" = s.id
      WHERE g."userId" = ${userId}
    )
    SELECT id FROM subtree`;
  return rows.map((r) => r.id);
}

/** All ancestor ids (excluding `id`), scoped to the owner. */
async function ancestorIds(
  tx: TxClient,
  id: string,
  userId: string,
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE anc(id) AS (
      SELECT "parentId" AS id FROM "Goal"
      WHERE id = ${id} AND "parentId" IS NOT NULL AND "userId" = ${userId}
      UNION ALL
      SELECT g."parentId" FROM "Goal" g
      JOIN anc a ON g.id = a.id
      WHERE g."parentId" IS NOT NULL AND g."userId" = ${userId}
    )
    SELECT id FROM anc WHERE id IS NOT NULL`;
  return rows.map((r) => r.id);
}

/* ------------------------------------------------------------------ */
/* createGoal                                                          */
/* ------------------------------------------------------------------ */

/**
 * `title` may be empty: the outliner creates empty bullets (Enter) that get
 * their title via `updateGoalTitle` once typed — which *does* enforce
 * non-empty. `index`, when provided, inserts at that sibling position
 * (shifting later siblings) inside one transaction; default appends.
 */
const createSchema = z.object({
  title: z.string().trim().max(500),
  parentId: z.string().nullish(),
  category: categorySchema,
  index: z.number().int().min(0).optional(),
});

export async function createGoal(input: {
  title: string;
  parentId?: string | null;
  category?: string | null;
  index?: number;
}): Promise<ActionResult<Goal>> {
  try {
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid input");
    const { title, category, index } = parsed.data;
    const parentId = parsed.data.parentId ?? null;

    const userId = await getUserId();

    if (parentId) {
      const parent = await prisma.goal.findFirst({ where: { id: parentId, userId } });
      if (!parent) return err("Parent goal not found");
    }

    const goal = await prisma.$transaction(async (tx) => {
      let order: number;
      if (index === undefined) {
        const max = await tx.goal.aggregate({
          where: { userId, parentId },
          _max: { order: true },
        });
        order = (max._max.order ?? -1) + 1;
      } else {
        const siblingCount = await tx.goal.count({ where: { userId, parentId } });
        order = Math.min(index, siblingCount);
        await tx.goal.updateMany({
          where: { userId, parentId, order: { gte: order } },
          data: { order: { increment: 1 } },
        });
      }
      return tx.goal.create({
        data: {
          title,
          parentId,
          category: category ?? null,
          userId,
          order,
        },
      });
    });

    revalidateGoalPaths();
    return ok(goal);
  } catch (e) {
    console.error("createGoal failed", e);
    return err(errorMessage(e));
  }
}

/* ------------------------------------------------------------------ */
/* toggleGoal                                                          */
/* ------------------------------------------------------------------ */

/**
 * Cascade semantics (chosen, documented):
 *  - Marking a goal COMPLETE marks its entire subtree complete.
 *  - Marking a goal INCOMPLETE also marks all its ANCESTORS incomplete
 *    (a parent cannot be done while a child is open).
 * Both directions run inside a single transaction.
 */
export async function toggleGoal(id: string): Promise<ActionResult<Goal>> {
  try {
    const userId = await getUserId();
    const goal = await prisma.goal.findFirst({ where: { id, userId } });
    if (!goal) return err("Goal not found");

    const next = !goal.isCompleted;

    await prisma.$transaction(async (tx) => {
      if (next) {
        const ids = await subtreeIds(tx, id, userId);
        await tx.goal.updateMany({
          where: { id: { in: ids }, userId },
          data: { isCompleted: true },
        });
      } else {
        await tx.goal.update({ where: { id }, data: { isCompleted: false } });
        const ancestors = await ancestorIds(tx, id, userId);
        if (ancestors.length > 0) {
          await tx.goal.updateMany({
            where: { id: { in: ancestors }, userId },
            data: { isCompleted: false },
          });
        }
      }
    });

    // Ledger: completing a goal logs to today's note (best-effort — a ledger
    // failure must never fail the toggle itself).
    if (next) {
      try {
        const date = todayKey();
        const note = await prisma.dailyNote.upsert({
          where: { userId_date: { userId, date } },
          create: { userId, date },
          update: {},
        });
        await prisma.ledgerEntry.create({
          data: {
            dailyNoteId: note.id,
            kind: "goal-completed",
            text: ledgerGoalCompleted(goal.title),
          },
        });
      } catch (ledgerError) {
        console.error("toggleGoal ledger write failed", ledgerError);
      }
    }

    revalidateGoalPaths();
    return ok({ ...goal, isCompleted: next });
  } catch (e) {
    console.error("toggleGoal failed", e);
    return err(errorMessage(e));
  }
}

/* ------------------------------------------------------------------ */
/* updateGoalTitle                                                     */
/* ------------------------------------------------------------------ */

export async function updateGoalTitle(
  id: string,
  title: string,
): Promise<ActionResult<Goal>> {
  try {
    const parsed = titleSchema.safeParse(title);
    if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid title");

    const userId = await getUserId();
    const existing = await prisma.goal.findFirst({ where: { id, userId } });
    if (!existing) return err("Goal not found");

    const goal = await prisma.goal.update({
      where: { id },
      data: { title: parsed.data },
    });

    revalidateGoalPaths();
    return ok(goal);
  } catch (e) {
    console.error("updateGoalTitle failed", e);
    return err(errorMessage(e));
  }
}

/* ------------------------------------------------------------------ */
/* updateGoalCategory                                                  */
/* ------------------------------------------------------------------ */

/** Set or clear a goal's free-text category (empty string clears to null). */
export async function updateGoalCategory(
  id: string,
  category: string | null,
): Promise<ActionResult<Goal>> {
  try {
    const parsed = categorySchema.safeParse(category);
    if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid category");

    const userId = await getUserId();
    const existing = await prisma.goal.findFirst({ where: { id, userId } });
    if (!existing) return err("Goal not found");

    const trimmed = parsed.data?.trim() ?? null;
    const goal = await prisma.goal.update({
      where: { id },
      data: { category: trimmed === "" ? null : trimmed },
    });

    revalidateGoalPaths();
    return ok(goal);
  } catch (e) {
    console.error("updateGoalCategory failed", e);
    return err(errorMessage(e));
  }
}

/* ------------------------------------------------------------------ */
/* renameCategory / deleteCategory (tag management)                    */
/* ------------------------------------------------------------------ */

/** Rename a tag everywhere it appears. Merging into an existing tag is allowed. */
export async function renameCategory(
  from: string,
  to: string,
): Promise<ActionResult<{ updated: number }>> {
  try {
    const fromParsed = categorySchema.safeParse(from);
    const toParsed = z.string().trim().min(1, "Tag name cannot be empty").max(50).safeParse(to);
    if (!fromParsed.success || !fromParsed.data) return err("Unknown tag");
    if (!toParsed.success) return err(toParsed.error.issues[0]?.message ?? "Invalid tag");
    if (fromParsed.data === toParsed.data) return ok({ updated: 0 });

    const userId = await getUserId();
    const result = await prisma.goal.updateMany({
      where: { userId, category: fromParsed.data },
      data: { category: toParsed.data },
    });

    revalidateGoalPaths();
    return ok({ updated: result.count });
  } catch (e) {
    console.error("renameCategory failed", e);
    return err(errorMessage(e));
  }
}

/** Delete a tag — clears it from every goal (goals themselves are kept). */
export async function deleteCategory(name: string): Promise<ActionResult<{ cleared: number }>> {
  try {
    const parsed = categorySchema.safeParse(name);
    if (!parsed.success || !parsed.data) return err("Unknown tag");

    const userId = await getUserId();
    const result = await prisma.goal.updateMany({
      where: { userId, category: parsed.data },
      data: { category: null },
    });

    revalidateGoalPaths();
    return ok({ cleared: result.count });
  } catch (e) {
    console.error("deleteCategory failed", e);
    return err(errorMessage(e));
  }
}

/* ------------------------------------------------------------------ */
/* deleteGoal                                                          */
/* ------------------------------------------------------------------ */

/**
 * Recursively deletes the whole subtree in one transaction.
 *
 * The schema declares `onDelete: Cascade` on the self-relation (real on
 * SQLite — Prisma enables `PRAGMA foreign_keys`), so children would be
 * removed by the database anyway. We still enumerate and delete the subtree
 * explicitly: the behaviour then stays identical on providers whose
 * self-relation cascades are limited, and the post-delete count check acts
 * as an orphan guard. Cost is one extra indexed recursive query.
 */
export async function deleteGoal(id: string): Promise<ActionResult<{ deleted: number }>> {
  try {
    const userId = await getUserId();
    const goal = await prisma.goal.findFirst({ where: { id, userId } });
    if (!goal) return err("Goal not found");

    const deleted = await prisma.$transaction(async (tx) => {
      const ids = await subtreeIds(tx, id, userId);
      const result = await tx.goal.deleteMany({ where: { id: { in: ids }, userId } });
      if (result.count !== ids.length) {
        throw new Error(`Delete guard: expected ${ids.length} rows, removed ${result.count}`);
      }
      // Orphan guard: no surviving row may point into the deleted set.
      const orphans = await tx.goal.count({ where: { parentId: { in: ids } } });
      if (orphans > 0) throw new Error("Delete guard: orphaned children detected");
      return result.count;
    });

    revalidateGoalPaths();
    return ok({ deleted });
  } catch (e) {
    console.error("deleteGoal failed", e);
    return err(errorMessage(e));
  }
}

/* ------------------------------------------------------------------ */
/* reorderGoals                                                        */
/* ------------------------------------------------------------------ */

const reorderSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1).max(500),
  parentId: z.string().nullable(),
});

/**
 * Batch-updates sibling order in ONE batched transaction (single
 * begin/commit — no per-item client round-trips). `orderedIds` must exactly
 * match the current sibling set for the given parent, so a stale client
 * can't silently drop or inject rows.
 */
export async function reorderGoals(input: {
  orderedIds: string[];
  parentId: string | null;
}): Promise<ActionResult<{ reordered: number }>> {
  try {
    const parsed = reorderSchema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid input");
    const { orderedIds, parentId } = parsed.data;

    const userId = await getUserId();
    const siblings = await prisma.goal.findMany({
      where: { userId, parentId },
      select: { id: true },
    });
    const siblingIds = new Set(siblings.map((s) => s.id));
    if (
      siblingIds.size !== orderedIds.length ||
      orderedIds.some((id) => !siblingIds.has(id))
    ) {
      return err("orderedIds must exactly match the current sibling set");
    }

    await prisma.$transaction(
      orderedIds.map((id, index) =>
        prisma.goal.update({ where: { id }, data: { order: index } }),
      ),
    );

    revalidateGoalPaths();
    return ok({ reordered: orderedIds.length });
  } catch (e) {
    console.error("reorderGoals failed", e);
    return err(errorMessage(e));
  }
}

/* ------------------------------------------------------------------ */
/* moveGoal                                                            */
/* ------------------------------------------------------------------ */

const moveSchema = z.object({
  id: z.string().min(1),
  newParentId: z.string().nullable(),
  newIndex: z.number().int().min(0),
});

/**
 * Moves a goal under a new parent at a clamped index (Tab/Shift+Tab in the
 * outliner). Re-sequences the order of both the old and new sibling lists
 * inside one interactive transaction.
 *
 * Cycle prevention: walks the ancestor chain of `newParentId` before
 * writing — a goal can never become its own descendant's parent.
 */
export async function moveGoal(input: {
  id: string;
  newParentId: string | null;
  newIndex: number;
}): Promise<ActionResult<Goal>> {
  try {
    const parsed = moveSchema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid input");
    const { id, newIndex } = parsed.data;
    const newParentId = parsed.data.newParentId ?? null;

    if (newParentId === id) return err("A goal cannot be its own parent");

    const userId = await getUserId();
    const goal = await prisma.goal.findFirst({ where: { id, userId } });
    if (!goal) return err("Goal not found");

    if (newParentId) {
      const parent = await prisma.goal.findFirst({ where: { id: newParentId, userId } });
      if (!parent) return err("Target parent not found");
    }

    // Cycle guard: walk up from the proposed parent.
    let cursor: string | null = newParentId;
    let guard = 0;
    while (cursor && guard++ < 500) {
      if (cursor === id) return err("Cannot move a goal under its own descendant");
      const row: { parentId: string | null } | null = await prisma.goal.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      if (!row) return err("Target parent not found");
      cursor = row.parentId;
    }
    if (guard >= 500) return err("Ancestor chain too deep — possible data corruption");

    const updated = await prisma.$transaction(async (tx) => {
      const sameParent = (goal.parentId ?? null) === newParentId;

      const oldSiblings = await tx.goal.findMany({
        where: { userId, parentId: goal.parentId },
        orderBy: { order: "asc" },
        select: { id: true },
      });
      const newSiblings = sameParent
        ? oldSiblings
        : await tx.goal.findMany({
            where: { userId, parentId: newParentId },
            orderBy: { order: "asc" },
            select: { id: true },
          });

      const oldIds = oldSiblings.map((s) => s.id).filter((sid) => sid !== id);
      const newIds = (sameParent ? oldSiblings : newSiblings)
        .map((s) => s.id)
        .filter((sid) => sid !== id);

      const clamped = Math.max(0, Math.min(newIndex, newIds.length));
      newIds.splice(clamped, 0, id);

      if (!sameParent) {
        for (let i = 0; i < oldIds.length; i++) {
          await tx.goal.update({ where: { id: oldIds[i] }, data: { order: i } });
        }
      }
      for (let i = 0; i < newIds.length; i++) {
        await tx.goal.update({
          where: { id: newIds[i] },
          data:
            newIds[i] === id ? { parentId: newParentId, order: i } : { order: i },
        });
      }

      return tx.goal.findUniqueOrThrow({ where: { id } });
    });

    revalidateGoalPaths();
    return ok(updated);
  } catch (e) {
    console.error("moveGoal failed", e);
    return err(errorMessage(e));
  }
}
