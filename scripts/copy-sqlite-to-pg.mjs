/**
 * One-off data copy: legacy SQLite dev.db → production Postgres (Neon).
 *
 * Usage:
 *   PROD_DATABASE_URL="postgresql://..." node scripts/copy-sqlite-to-pg.mjs
 *
 * Idempotent (skipDuplicates everywhere) and FK-safe: rows are inserted in
 * dependency order, with Goal self-references inserted parents-first.
 * Type coercion (SQLite DateTime/boolean → PG) is handled by the two
 * Prisma clients.
 */
import sourcePkg from "sqlite-source-client";
import { PrismaClient } from "@prisma/client";

const url = process.env.PROD_DATABASE_URL;
if (!url) {
  console.error("PROD_DATABASE_URL is required");
  process.exit(1);
}

const src = new sourcePkg.PrismaClient();
const dst = new PrismaClient({ datasourceUrl: url });

/** Parents before children so the Goal self-FK is never violated. */
function topoSortGoals(goals) {
  const byId = new Map(goals.map((g) => [g.id, g]));
  const done = new Set();
  const out = [];
  let pending = [...goals];
  while (pending.length) {
    const ready = pending.filter((g) => !g.parentId || done.has(g.parentId) || !byId.has(g.parentId));
    if (!ready.length) throw new Error("Goal cycle detected — cannot order parents-first");
    for (const g of ready) {
      out.push(g);
      done.add(g.id);
    }
    pending = pending.filter((g) => !done.has(g.id));
  }
  return out;
}

async function copy(label, rows, createMany, countTarget) {
  const { count } = await createMany(rows);
  const total = await countTarget();
  console.log(`${label.padEnd(14)} source=${rows.length}  inserted=${count}  target-total=${total}`);
  return { source: rows.length, inserted: count, total };
}

try {
  const goals = topoSortGoals(await src.goal.findMany());
  const notes = await src.dailyNote.findMany();
  const ledger = await src.ledgerEntry.findMany();
  const backlog = await src.backlogItem.findMany();
  const blocks = await src.timeBlock.findMany();
  const links = await src.timeBlockGoal.findMany();

  for (const g of goals) {
    await dst.goal.upsert({ where: { id: g.id }, create: g, update: {} });
  }
  console.log(`${"Goal".padEnd(14)} source=${goals.length}  inserted=upserted  target-total=${await dst.goal.count()}`);

  await copy("DailyNote", notes, (r) => dst.dailyNote.createMany({ data: r, skipDuplicates: true }), () => dst.dailyNote.count());
  await copy("LedgerEntry", ledger, (r) => dst.ledgerEntry.createMany({ data: r, skipDuplicates: true }), () => dst.ledgerEntry.count());
  await copy("BacklogItem", backlog, (r) => dst.backlogItem.createMany({ data: r, skipDuplicates: true }), () => dst.backlogItem.count());
  await copy("TimeBlock", blocks, (r) => dst.timeBlock.createMany({ data: r, skipDuplicates: true }), () => dst.timeBlock.count());
  await copy("TimeBlockGoal", links, (r) => dst.timeBlockGoal.createMany({ data: r, skipDuplicates: true }), () => dst.timeBlockGoal.count());
} finally {
  await src.$disconnect();
  await dst.$disconnect();
}
