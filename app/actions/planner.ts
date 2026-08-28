"use server";

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { ok, err, type ActionResult } from "@/lib/result";
import type { Goal } from "@/lib/goals/types";
import { todayKey } from "@/lib/date-key";
import { clampSpan, coverageMap, rangeFree } from "@/lib/time-span";
import { ledgerCarried, ledgerDid, ledgerExtra, ledgerPlanned, ledgerRemoved, ledgerUndid } from "@/lib/ledger";

type TxClient = Prisma.TransactionClient;

/** Append a ledger line (inside a transaction when one is running). */
async function logLedger(
  tx: TxClient,
  dailyNoteId: string,
  kind: string,
  text: string,
): Promise<void> {
  await tx.ledgerEntry.create({ data: { dailyNoteId, kind, text } });
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Unexpected error";
}

const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");
const hourSchema = z.number().int().min(0).max(23);

async function findOrCreateDailyNote(userId: string, date: string) {
  return prisma.dailyNote.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date },
    update: {},
  });
}

async function findOrCreateTimeBlock(dailyNoteId: string, hour: number) {
  return prisma.timeBlock.upsert({
    where: { dailyNoteId_hour: { dailyNoteId, hour } },
    create: { dailyNoteId, hour },
    update: {},
  });
}

/* ------------------------------------------------------------------ */
/* upsertTimeBlockTask                                                 */
/* ------------------------------------------------------------------ */

const taskSchema = z.object({
  date: dateKeySchema,
  hour: hourSchema,
  task: z.string().max(1000),
});

export async function upsertTimeBlockTask(input: {
  date: string;
  hour: number;
  task: string;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = taskSchema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid input");
    const { date, hour, task } = parsed.data;

    const userId = await getUserId();
    const note = await findOrCreateDailyNote(userId, date);
    const block = await findOrCreateTimeBlock(note.id, hour);
    const updated = await prisma.timeBlock.update({
      where: { id: block.id },
      data: { task },
    });

    revalidatePath("/today");
    return ok({ id: updated.id });
  } catch (e) {
    console.error("upsertTimeBlockTask failed", e);
    return err(errorMessage(e));
  }
}

/* ------------------------------------------------------------------ */
/* linkGoalToTimeBlock / unlinkGoalFromTimeBlock                       */
/* ------------------------------------------------------------------ */

const linkSchema = z.object({
  date: dateKeySchema,
  hour: hourSchema,
  goalId: z.string().min(1),
});

export async function linkGoalToTimeBlock(input: {
  date: string;
  hour: number;
  goalId: string;
}): Promise<ActionResult<{ linked: boolean }>> {
  try {
    const parsed = linkSchema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid input");
    const { date, hour, goalId } = parsed.data;

    const userId = await getUserId();
    const goal = await prisma.goal.findFirst({ where: { id: goalId, userId } });
    if (!goal) return err("Goal not found");

    const note = await findOrCreateDailyNote(userId, date);
    const block = await findOrCreateTimeBlock(note.id, hour);
    await prisma.timeBlockGoal.upsert({
      where: { timeBlockId_goalId: { timeBlockId: block.id, goalId } },
      create: { timeBlockId: block.id, goalId },
      update: {},
    });

    revalidatePath("/today");
    return ok({ linked: true });
  } catch (e) {
    console.error("linkGoalToTimeBlock failed", e);
    return err(errorMessage(e));
  }
}

const unlinkSchema = z.object({
  date: dateKeySchema,
  hour: hourSchema,
  goalId: z.string().min(1),
});

export async function unlinkGoalFromTimeBlock(input: {
  date: string;
  hour: number;
  goalId: string;
}): Promise<ActionResult<{ unlinked: boolean }>> {
  try {
    const parsed = unlinkSchema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid input");
    const { date, hour, goalId } = parsed.data;

    const userId = await getUserId();
    const note = await prisma.dailyNote.findUnique({
      where: { userId_date: { userId, date } },
    });
    if (!note) return ok({ unlinked: false });

    const block = await prisma.timeBlock.findUnique({
      where: { dailyNoteId_hour: { dailyNoteId: note.id, hour } },
    });
    if (!block) return ok({ unlinked: false });

    await prisma.timeBlockGoal.deleteMany({
      where: { timeBlockId: block.id, goalId },
    });

    revalidatePath("/today");
    return ok({ unlinked: true });
  } catch (e) {
    console.error("unlinkGoalFromTimeBlock failed", e);
    return err(errorMessage(e));
  }
}

/* ------------------------------------------------------------------ */
/* moveTimeBlock (drag-and-drop)                                       */
/* ------------------------------------------------------------------ */

const cellRefSchema = z.object({ date: dateKeySchema, hour: hourSchema });
const moveBlockSchema = z.object({ from: cellRefSchema, to: cellRefSchema });

/**
 * Moves a block (task + goal links) to another cell. Refuses to land on an
 * occupied cell (no silent merges); the source row is deleted afterwards —
 * days/hours are created lazily on demand anyway.
 */
export async function moveTimeBlock(input: {
  from: { date: string; hour: number };
  to: { date: string; hour: number };
}): Promise<ActionResult<{ moved: boolean }>> {
  try {
    const parsed = moveBlockSchema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid input");
    const { from, to } = parsed.data;
    if (from.date === to.date && from.hour === to.hour) return ok({ moved: false });

    const userId = await getUserId();
    const sourceNote = await prisma.dailyNote.findUnique({
      where: { userId_date: { userId, date: from.date } },
    });
    if (!sourceNote) return err("No block at the source slot");
    const source = await prisma.timeBlock.findUnique({
      where: { dailyNoteId_hour: { dailyNoteId: sourceNote.id, hour: from.hour } },
      include: { goalLinks: true },
    });
    if (!source || (source.task.length === 0 && source.goalLinks.length === 0)) {
      return err("No block at the source slot");
    }

    const targetNote = await findOrCreateDailyNote(userId, to.date);
    // Span-aware collision: every cell the moved block would cover must be free
    // (excluding the source itself when moving within the same day).
    const dayBlocks = await prisma.timeBlock.findMany({
      where: { dailyNoteId: targetNote.id },
      select: { hour: true, span: true },
    });
    const free = rangeFree(
      dayBlocks,
      to.hour,
      source.span,
      from.date === to.date ? from.hour : undefined,
    );
    if (!free) return err("That slot overlaps another task");

    await prisma.$transaction(async (tx) => {
      const target = await tx.timeBlock.upsert({
        where: { dailyNoteId_hour: { dailyNoteId: targetNote.id, hour: to.hour } },
        create: {
          dailyNoteId: targetNote.id,
          hour: to.hour,
          task: source.task,
          span: source.span,
        },
        update: { task: source.task, span: source.span },
      });
      await tx.timeBlockGoal.deleteMany({ where: { timeBlockId: target.id } });
      if (source.goalLinks.length > 0) {
        await tx.timeBlockGoal.createMany({
          data: source.goalLinks.map((l) => ({ timeBlockId: target.id, goalId: l.goalId })),
        });
      }
      await tx.timeBlock.delete({ where: { id: source.id } }); // cascades its links
    });

    revalidatePath("/today");
    return ok({ moved: true });
  } catch (e) {
    console.error("moveTimeBlock failed", e);
    return err(errorMessage(e));
  }
}

/* ------------------------------------------------------------------ */
/* setTimeBlockSpan (multi-hour tasks)                                 */
/* ------------------------------------------------------------------ */

const spanSchema = z.object({
  date: dateKeySchema,
  hour: hourSchema,
  span: z.number().int().min(1).max(18),
});

/** Resize a block to `span` hours. Rejects overlaps with other blocks. */
export async function setTimeBlockSpan(input: {
  date: string;
  hour: number;
  span: number;
}): Promise<ActionResult<{ span: number }>> {
  try {
    const parsed = spanSchema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid input");
    const { date, hour } = parsed.data;

    const userId = await getUserId();
    const note = await prisma.dailyNote.findUnique({
      where: { userId_date: { userId, date } },
    });
    if (!note) return err("No block at that slot");
    const block = await prisma.timeBlock.findUnique({
      where: { dailyNoteId_hour: { dailyNoteId: note.id, hour } },
    });
    if (!block) return err("No block at that slot");

    const span = clampSpan(hour, parsed.data.span);
    const dayBlocks = await prisma.timeBlock.findMany({
      where: { dailyNoteId: note.id },
      select: { hour: true, span: true },
    });
    if (!rangeFree(dayBlocks, hour, span, hour)) {
      return err("That overlaps another task");
    }

    await prisma.timeBlock.update({ where: { id: block.id }, data: { span } });
    revalidatePath("/today");
    return ok({ span });
  } catch (e) {
    console.error("setTimeBlockSpan failed", e);
    return err(errorMessage(e));
  }
}

/* ------------------------------------------------------------------ */
/* toggleTimeBlockDone                                                 */
/* ------------------------------------------------------------------ */

/** Flip a block's done state (null ↔ now) and log did/undid to the ledger. */
export async function toggleTimeBlockDone(input: {
  date: string;
  hour: number;
}): Promise<ActionResult<{ done: boolean }>> {
  try {
    const schema = z.object({ date: dateKeySchema, hour: hourSchema });
    const parsed = schema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid input");
    const { date, hour } = parsed.data;

    const userId = await getUserId();
    const note = await prisma.dailyNote.findUnique({
      where: { userId_date: { userId, date } },
    });
    if (!note) return err("No block at that slot");
    const block = await prisma.timeBlock.findUnique({
      where: { dailyNoteId_hour: { dailyNoteId: note.id, hour } },
    });
    if (!block) return err("No block at that slot");

    const done = block.doneAt === null;
    const label = block.task || "goal block";
    await prisma.$transaction(async (tx) => {
      await tx.timeBlock.update({
        where: { id: block.id },
        data: { doneAt: done ? new Date() : null },
      });
      await logLedger(
        tx,
        note.id,
        done ? "did" : "undid",
        done
          ? ledgerDid(label, block.hour, block.span)
          : ledgerUndid(label, block.hour, block.span),
      );
    });

    revalidatePath("/today");
    return ok({ done });
  } catch (e) {
    console.error("toggleTimeBlockDone failed", e);
    return err(errorMessage(e));
  }
}

/* ------------------------------------------------------------------ */
/* deleteTimeBlock                                                     */
/* ------------------------------------------------------------------ */

/**
 * Deletes a block; its goal links cascade and the removal is ledger-logged.
 * Idempotent — deleting an empty slot is a no-op success (the client may
 * have optimistically removed it).
 */
export async function deleteTimeBlock(input: {
  date: string;
  hour: number;
}): Promise<ActionResult<{ deleted: boolean }>> {
  try {
    const schema = z.object({ date: dateKeySchema, hour: hourSchema });
    const parsed = schema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid input");
    const { date, hour } = parsed.data;

    const userId = await getUserId();
    const note = await prisma.dailyNote.findUnique({
      where: { userId_date: { userId, date } },
    });
    if (!note) return ok({ deleted: false });
    const block = await prisma.timeBlock.findUnique({
      where: { dailyNoteId_hour: { dailyNoteId: note.id, hour } },
    });
    if (!block) return ok({ deleted: false });

    await prisma.$transaction(async (tx) => {
      await tx.timeBlock.delete({ where: { id: block.id } });
      await logLedger(
        tx,
        note.id,
        "removed",
        ledgerRemoved(block.task || "goal block", block.hour),
      );
    });

    revalidatePath("/today");
    return ok({ deleted: true });
  } catch (e) {
    console.error("deleteTimeBlock failed", e);
    return err(errorMessage(e));
  }
}

/* ------------------------------------------------------------------ */
/* planBacklogItem (drag backlog → calendar cell)                      */
/* ------------------------------------------------------------------ */

/**
 * Turns a backlog item into a time block (task = goal title, goal linked)
 * and REMOVES the backlog row — a drop is a move, not a copy. One
 * transaction; rejects occupied or span-covered target cells.
 */
export async function planBacklogItem(input: {
  backlogItemId: string;
  date: string;
  hour: number;
}): Promise<ActionResult<{ planned: boolean }>> {
  try {
    const schema = z.object({
      backlogItemId: z.string().min(1),
      date: dateKeySchema,
      hour: hourSchema,
    });
    const parsed = schema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid input");
    const { backlogItemId, date, hour } = parsed.data;

    const userId = await getUserId();
    const item = await prisma.backlogItem.findFirst({
      where: { id: backlogItemId, dailyNote: { userId } },
      include: { goal: true },
    });
    if (!item) return err("Backlog item not found");

    const note = await findOrCreateDailyNote(userId, date);
    const dayBlocks = await prisma.timeBlock.findMany({
      where: { dailyNoteId: note.id },
      include: { goalLinks: true },
    });
    const coverage = coverageMap(dayBlocks);
    const exact = dayBlocks.find((b) => b.hour === hour);
    const occupied =
      coverage.has(hour) || (!!exact && (exact.task.length > 0 || exact.goalLinks.length > 0));
    if (occupied) return err("That slot already has a task");

    await prisma.$transaction(async (tx) => {
      const block = await tx.timeBlock.upsert({
        where: { dailyNoteId_hour: { dailyNoteId: note.id, hour } },
        create: { dailyNoteId: note.id, hour, task: item.goal.title },
        update: { task: item.goal.title },
      });
      await tx.timeBlockGoal.upsert({
        where: { timeBlockId_goalId: { timeBlockId: block.id, goalId: item.goalId } },
        create: { timeBlockId: block.id, goalId: item.goalId },
        update: {},
      });
      await tx.backlogItem.delete({ where: { id: item.id } });
      await logLedger(tx, note.id, "planned", ledgerPlanned(item.goal.title, hour, 1));
    });

    revalidatePath("/today");
    return ok({ planned: true });
  } catch (e) {
    console.error("planBacklogItem failed", e);
    return err(errorMessage(e));
  }
}

/* ------------------------------------------------------------------ */
/* carryOverBacklog (rollover banner)                                  */
/* ------------------------------------------------------------------ */

/**
 * Moves every backlog item from one day to another. Idempotent: items already
 * present at the target (unique on dailyNoteId+goalId) are skipped, not
 * duplicated. Returns the count actually moved.
 */
export async function carryOverBacklog(input: {
  fromDate: string;
  toDate: string;
}): Promise<ActionResult<{ moved: number }>> {
  try {
    const schema = z.object({ fromDate: dateKeySchema, toDate: dateKeySchema });
    const parsed = schema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid input");
    const { fromDate, toDate } = parsed.data;
    if (fromDate === toDate) return err("Same day");

    const userId = await getUserId();
    const source = await prisma.dailyNote.findUnique({
      where: { userId_date: { userId, date: fromDate } },
      include: { backlogItems: true },
    });
    if (!source || source.backlogItems.length === 0) return ok({ moved: 0 });

    const target = await findOrCreateDailyNote(userId, toDate);
    const existing = await prisma.backlogItem.findMany({
      where: { dailyNoteId: target.id },
      select: { goalId: true },
    });
    const alreadyThere = new Set(existing.map((i) => i.goalId));
    const toMove = source.backlogItems.filter((i) => !alreadyThere.has(i.goalId));

    await prisma.$transaction(async (tx) => {
      if (toMove.length > 0) {
        await tx.backlogItem.createMany({
          data: toMove.map((i) => ({
            dailyNoteId: target.id,
            goalId: i.goalId,
            note: i.note,
          })),
        });
      }
      await tx.backlogItem.deleteMany({
        where: { dailyNoteId: source.id, goalId: { in: toMove.map((i) => i.goalId) } },
      });
      if (toMove.length > 0) {
        const [fy, fm, fd] = fromDate.split("-").map(Number);
        const fromLabel = new Intl.DateTimeFormat("en-GB", {
          day: "numeric",
          month: "short",
        }).format(new Date(fy, fm - 1, fd));
        await logLedger(tx, target.id, "carried", ledgerCarried(toMove.length, fromLabel));
      }
    });

    revalidatePath("/today");
    return ok({ moved: toMove.length });
  } catch (e) {
    console.error("carryOverBacklog failed", e);
    return err(errorMessage(e));
  }
}

/* ------------------------------------------------------------------ */
/* createExtraGoal (Extras quick-add)                                  */
/* ------------------------------------------------------------------ */

/**
 * Extras quick-add fallback: creates a ROOT goal with the given title and
 * sends it straight into today's Extras — one transaction, one ledger line.
 * Keeps every Extra goal-backed (drag-to-calendar and coverage keep working).
 */
export async function createExtraGoal(input: {
  title: string;
}): Promise<ActionResult<Goal>> {
  try {
    const title = z.string().trim().min(1, "Title cannot be empty").max(500).parse(input.title);
    const userId = await getUserId();

    const goal = await prisma.$transaction(async (tx) => {
      const max = await tx.goal.aggregate({
        where: { userId, parentId: null },
        _max: { order: true },
      });
      const created = await tx.goal.create({
        data: { title, userId, parentId: null, order: (max._max.order ?? -1) + 1 },
      });
      const note = await tx.dailyNote.upsert({
        where: { userId_date: { userId, date: todayKey() } },
        create: { userId, date: todayKey() },
        update: {},
      });
      await tx.backlogItem.create({
        data: { dailyNoteId: note.id, goalId: created.id },
      });
      await logLedger(tx, note.id, "extra", ledgerExtra(title));
      return created;
    });

    revalidatePath("/today");
    revalidatePath("/goals");
    return ok(goal);
  } catch (e) {
    console.error("createExtraGoal failed", e);
    return err(errorMessage(e));
  }
}

/* ------------------------------------------------------------------ */
/* sendGoalToBacklog                                                   */
/* ------------------------------------------------------------------ */

/**
 * Idempotent-ish by construction: the (dailyNoteId, goalId) unique
 * constraint makes a second send of the same goal a no-op, surfaced to the
 * caller as `already: true` ("Already in Extras").
 */
export async function sendGoalToBacklog(input: {
  goalId: string;
}): Promise<ActionResult<{ already: boolean }>> {
  try {
    const goalId = z.string().min(1).parse(input.goalId);

    const userId = await getUserId();
    const goal = await prisma.goal.findFirst({ where: { id: goalId, userId } });
    if (!goal) return err("Goal not found");

    const note = await findOrCreateDailyNote(userId, todayKey());
    try {
      await prisma.backlogItem.create({
        data: { dailyNoteId: note.id, goalId },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return ok({ already: true });
      }
      throw e;
    }

    revalidatePath("/today");
    return ok({ already: false });
  } catch (e) {
    console.error("sendGoalToBacklog failed", e);
    return err(errorMessage(e));
  }
}

/* ------------------------------------------------------------------ */
/* removeBacklogItem                                                   */
/* ------------------------------------------------------------------ */

export async function removeBacklogItem(input: {
  id: string;
}): Promise<ActionResult<{ removed: boolean }>> {
  try {
    const id = z.string().min(1).parse(input.id);
    const userId = await getUserId();

    const item = await prisma.backlogItem.findFirst({
      where: { id, dailyNote: { userId } },
    });
    if (!item) return err("Backlog item not found");

    await prisma.backlogItem.delete({ where: { id } });
    revalidatePath("/today");
    return ok({ removed: true });
  } catch (e) {
    console.error("removeBacklogItem failed", e);
    return err(errorMessage(e));
  }
}
